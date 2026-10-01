package meta

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"slices"
	"strings"
	"time"

	"github.com/verniyyy/battle_ship/backend/internal/game"
)

// Duels (beta) pit two admirals against each other on an 8×8 sea. One opens a
// room and passes its code on; the other joins with it. Each deploys their
// current formation in secret within their own zone, the bottom rows of the
// sea as they see it, then every round both commit an action and the round
// resolves once both are in, just as against the CPU.
//
// There are no live connections: both clients poll, and whoever asks after a
// deadline has passed moves the duel on. An admiral who lets a round run out
// skips it; one who lets DuelMaxMisses rounds in a row run out loses. Duels
// pay no rewards while in beta, so nobody gains from throwing one.
const (
	DuelSize     = 8
	DuelMaxTurns = 30
	// DuelZoneRows is how many rows at each admiral's end of the sea they deploy in.
	DuelZoneRows  = 3
	DuelMaxMisses = 3

	DuelOpenFor   = 10 * time.Minute // a room nobody joins closes
	DuelPlaceTime = 3 * time.Minute  // then an unplaced fleet is deployed at random
	DuelRoundTime = 60 * time.Second // then a missing order is a skipped round

	DuelCodeLen = 6
)

type DuelPhase string

const (
	DuelOpen      DuelPhase = "open"      // waiting for an opponent to join
	DuelPlacing   DuelPhase = "placing"   // both deploying their fleets
	DuelBattle    DuelPhase = "battle"    // rounds being played
	DuelFinished  DuelPhase = "finished"  // the battle is decided
	DuelCancelled DuelPhase = "cancelled" // closed before the battle began
)

// Active reports whether the duel still ties its admirals up.
func (p DuelPhase) Active() bool { return p == DuelOpen || p == DuelPlacing || p == DuelBattle }

// Duellist is one admiral of a duel, with the fleet they brought.
type Duellist struct {
	ID    string      `json:"id"`
	Name  string      `json:"name"`
	Level int         `json:"level"`
	Power int         `json:"power"`
	Fleet []game.Spec `json:"fleet"`
	// Placement is where the fleet deployed, on the real sea; nil until then.
	Placement []game.Pos `json:"placement,omitempty"`
	// Pending is the order committed for the current round, on the real sea.
	Pending *game.Action `json:"pending,omitempty"`
	// Missed counts the rounds in a row that ran out without an order.
	Missed int `json:"missed,omitempty"`
}

// Duel is the whole duel as stored. The host plays SidePlayer, the guest SideCPU.
type Duel struct {
	Code  string      `json:"code"`
	Phase DuelPhase   `json:"phase"`
	Host  *Duellist   `json:"host"`
	Guest *Duellist   `json:"guest,omitempty"`
	Game  *game.State `json:"game,omitempty"`
	// Deadline is when the current phase or round runs out.
	Deadline time.Time `json:"deadline"`
	Created  time.Time `json:"created"`
	// Rev counts the changes, so a poll can tell whether anything happened.
	Rev int `json:"rev"`
}

// ErrDuelMoved refuses a request made on an out-of-date view of the duel: the
// round was already played, or the duel moved to another phase meanwhile.
var ErrDuelMoved = errors.New("対戦の状況が進んでいたため、最新の状態に更新します")

var (
	errNoFleet    = Refusal("編成に艦がいません。編成してから対戦してください")
	errOwnRoom    = Refusal("自分の部屋には入れません")
	errRoomClosed = Refusal("その部屋はもう締め切られています")
	errActed      = Refusal("このターンの行動は決定済みです。相手を待っています")
	errPlaced     = Refusal("配置は決定済みです")
)

// NewDuelCode draws a room code from the friend-code alphabet.
func NewDuelCode(rng *rand.Rand) string {
	var b strings.Builder
	for range DuelCodeLen {
		b.WriteByte(friendCodeAlphabet[rng.IntN(len(friendCodeAlphabet))])
	}
	return b.String()
}

// NormalizeDuelCode reads a room code as typed.
func NormalizeDuelCode(s string) (string, bool) {
	s = strings.ToUpper(strings.NewReplacer("-", "", " ", "", "　", "").Replace(strings.TrimSpace(s)))
	if len(s) != DuelCodeLen {
		return "", false
	}
	for _, c := range s {
		if !strings.ContainsRune(friendCodeAlphabet, c) {
			return "", false
		}
	}
	return s, true
}

func duellist(p *Profile) (*Duellist, error) {
	if len(p.Fleet) == 0 {
		return nil, errNoFleet
	}
	d := &Duellist{ID: p.ID, Name: p.Name, Level: p.Level, Fleet: p.FleetSpecs()}
	for _, sp := range d.Fleet {
		d.Power += Power(sp)
	}
	return d, nil
}

// NewDuel opens a room for host with their current formation.
func NewDuel(host *Profile, code string, now time.Time) (*Duel, error) {
	h, err := duellist(host)
	if err != nil {
		return nil, err
	}
	return &Duel{Code: code, Phase: DuelOpen, Host: h, Deadline: now.Add(DuelOpenFor), Created: now}, nil
}

// Join seats guest, with their current formation, in an open room.
func (d *Duel) Join(guest *Profile, now time.Time) error {
	switch {
	case d.Host.ID == guest.ID:
		return errOwnRoom
	case d.Phase != DuelOpen || !now.Before(d.Deadline):
		return errRoomClosed
	}
	g, err := duellist(guest)
	if err != nil {
		return err
	}
	d.Guest = g
	d.Phase = DuelPlacing
	d.Deadline = now.Add(DuelPlaceTime)
	d.Rev++
	return nil
}

// SideOf is the side admiral pid plays, if they are in the duel.
func (d *Duel) SideOf(pid string) (game.Side, bool) {
	switch {
	case d.Host.ID == pid:
		return game.SidePlayer, true
	case d.Guest != nil && d.Guest.ID == pid:
		return game.SideCPU, true
	}
	return "", false
}

func (d *Duel) of(side game.Side) *Duellist {
	if side == game.SidePlayer {
		return d.Host
	}
	return d.Guest
}

// toSea turns a position as side sees it into one on the real sea.
func toSea(side game.Side, p game.Pos) game.Pos {
	if side == game.SideCPU {
		return p.Mirror(DuelSize)
	}
	return p
}

// InZone reports whether p, as an admiral sees the sea, lies in their deployment zone.
func InZone(p game.Pos) bool {
	return p.InBounds(DuelSize) && p.Row >= DuelSize-DuelZoneRows
}

// Place deploys side's fleet at ps, given as that admiral sees the sea. The
// battle begins once both fleets are deployed.
func (d *Duel) Place(side game.Side, ps []game.Pos, now time.Time, rng *rand.Rand) error {
	me := d.of(side)
	switch {
	case d.Phase != DuelPlacing:
		return ErrDuelMoved
	case me.Placement != nil:
		return errPlaced
	case len(ps) != len(me.Fleet):
		return fmt.Errorf("%w: deploy all %d ships", ErrInvalid, len(me.Fleet))
	}
	sea := make([]game.Pos, len(ps))
	for i, p := range ps {
		if !InZone(p) {
			return Refusal(fmt.Sprintf("配置できるのは手前の %d 列だけです", DuelZoneRows))
		}
		if slices.Contains(ps[:i], p) {
			return fmt.Errorf("%w: ships overlap", ErrInvalid)
		}
		sea[i] = toSea(side, p)
	}
	me.Placement = sea
	d.Rev++
	if d.Host.Placement != nil && d.Guest.Placement != nil {
		return d.begin(now, rng)
	}
	return nil
}

// randomZone deploys a fleet of n at random in side's zone, on the real sea.
func randomZone(side game.Side, n int, rng *rand.Rand) []game.Pos {
	var cells []game.Pos
	for r := DuelSize - DuelZoneRows; r < DuelSize; r++ {
		for c := range DuelSize {
			cells = append(cells, toSea(side, game.Pos{Row: r, Col: c}))
		}
	}
	rng.Shuffle(len(cells), func(i, j int) { cells[i], cells[j] = cells[j], cells[i] })
	return cells[:n]
}

func (d *Duel) begin(now time.Time, rng *rand.Rand) error {
	host, err := game.NewBoard(DuelSize, d.Host.Fleet, d.Host.Placement)
	if err != nil {
		return err
	}
	guest, err := game.NewBoard(DuelSize, d.Guest.Fleet, d.Guest.Placement)
	if err != nil {
		return err
	}
	d.Game = game.NewState(host, guest, DuelMaxTurns, game.AI{}, rollWeather(rng))
	d.Game.Duel = true
	d.Phase = DuelBattle
	d.Deadline = now.Add(DuelRoundTime)
	return nil
}

// Act commits side's order for the round, given as that admiral sees the sea.
// turn is the round count the order was chosen on. Once both orders are in,
// the round is played.
func (d *Duel) Act(side game.Side, a game.Action, turn int, now time.Time, rng *rand.Rand) error {
	me := d.of(side)
	switch {
	case d.Phase != DuelBattle:
		return ErrDuelMoved
	case turn != d.Game.Turn:
		return ErrDuelMoved
	case me.Pending != nil:
		return errActed
	}
	if side == game.SideCPU {
		a = a.Mirror(DuelSize)
	}
	if err := d.Game.Legal(side, a); err != nil {
		return err
	}
	me.Pending = &a
	d.Rev++
	if d.Host.Pending != nil && d.Guest.Pending != nil {
		d.resolve(now, rng)
	}
	return nil
}

// resolve plays the round with whatever orders are in.
func (d *Duel) resolve(now time.Time, rng *rand.Rand) {
	acts := map[game.Side]game.Action{}
	for _, side := range []game.Side{game.SidePlayer, game.SideCPU} {
		if p := d.of(side).Pending; p != nil {
			acts[side] = *p
		}
		d.of(side).Pending = nil
	}
	d.Game.Resolve(acts, rng)
	d.Deadline = now.Add(DuelRoundTime)
	if d.Game.Status == game.StatusFinished {
		d.Phase = DuelFinished
	}
}

// Due reports whether the current phase has run out and Tick would move it on.
func (d *Duel) Due(now time.Time) bool {
	return d.Phase.Active() && !now.Before(d.Deadline)
}

// Tick moves the duel on past a deadline that has run out: an unjoined room
// closes, unplaced fleets deploy at random, and a round plays without the
// missing orders (or, after too many, ends against whoever gave none).
func (d *Duel) Tick(now time.Time, rng *rand.Rand) bool {
	if !d.Due(now) {
		return false
	}
	d.Rev++
	switch d.Phase {
	case DuelOpen:
		d.Phase = DuelCancelled
	case DuelPlacing:
		for _, side := range []game.Side{game.SidePlayer, game.SideCPU} {
			if me := d.of(side); me.Placement == nil {
				me.Placement = randomZone(side, len(me.Fleet), rng)
			}
		}
		if err := d.begin(now, rng); err != nil {
			d.Phase = DuelCancelled
		}
	case DuelBattle:
		var out []game.Side
		for _, side := range []game.Side{game.SidePlayer, game.SideCPU} {
			me := d.of(side)
			if me.Pending != nil {
				me.Missed = 0
				continue
			}
			if me.Missed++; me.Missed >= DuelMaxMisses {
				out = append(out, side)
			}
		}
		switch len(out) {
		case 0:
			d.resolve(now, rng)
		case 1:
			d.end(out[0], game.EndTimeout)
		default:
			d.end("", game.EndTimeout)
		}
	}
	return true
}

func (d *Duel) end(loser game.Side, why game.EndReason) {
	_ = d.Game.Forfeit(loser, why)
	d.Host.Pending, d.Guest.Pending = nil, nil
	d.Phase = DuelFinished
}

// Leave takes side out of the duel: before the battle the room closes, during
// it they surrender.
func (d *Duel) Leave(side game.Side) error {
	switch d.Phase {
	case DuelOpen, DuelPlacing:
		d.Phase = DuelCancelled
	case DuelBattle:
		d.end(side, game.EndSurrender)
	default:
		return errRoomClosed
	}
	d.Rev++
	return nil
}

// Outcome is how the duel went for side: "win", "lose", "draw", or "" while
// it is undecided or was called off.
func (d *Duel) Outcome(side game.Side) string {
	if d.Phase != DuelFinished {
		return ""
	}
	switch d.Game.Winner {
	case "":
		return "draw"
	case side:
		return "win"
	}
	return "lose"
}

// WinnerID is the admiral who won, or "" for a draw or an undecided duel.
func (d *Duel) WinnerID() string {
	if d.Phase != DuelFinished || d.Game.Winner == "" {
		return ""
	}
	return d.of(d.Game.Winner).ID
}

// Opponent is the admiral side plays against (nil before anyone joins).
func (d *Duel) Opponent(side game.Side) *Duellist { return d.of(side.Opponent()) }

// ---- views ----

// DuelShip is a ship of a fleet as both admirals see it before the battle.
type DuelShip struct {
	Key    string         `json:"key"`
	Class  game.ShipClass `json:"class"`
	Name   string         `json:"name"`
	Rarity int            `json:"rarity"`
	HP     int            `json:"hp"`
	Speed  int            `json:"speed"`
}

// DuellistView is an admiral of the duel as shown to either side.
type DuellistView struct {
	Name  string     `json:"name"`
	Level int        `json:"level"`
	Power int        `json:"power"`
	Fleet []DuelShip `json:"fleet"`
	// Ready is whether they have deployed (placing) or given this round's order (battle).
	Ready  bool `json:"ready"`
	Missed int  `json:"missed,omitempty"`
}

// DuelView is the duel from one admiral's side.
type DuelView struct {
	Code  string    `json:"code"`
	Phase DuelPhase `json:"phase"`
	Rev   int       `json:"rev"`
	// Host is whether this admiral opened the room.
	Host     bool          `json:"host"`
	Me       DuellistView  `json:"me"`
	Opponent *DuellistView `json:"opponent,omitempty"`
	// SecondsLeft is how long the current phase or round has to run.
	SecondsLeft int `json:"secondsLeft"`
	// Placement is my fleet's deployment as I see the sea, once made.
	Placement []game.Pos `json:"placement,omitempty"`
	// Pending is my order for this round, as I see the sea, once given.
	Pending *game.Action `json:"pending,omitempty"`
	Game    *game.View   `json:"game,omitempty"`
	// Outcome is "win", "lose" or "draw" once the duel is decided.
	Outcome string `json:"outcome,omitempty"`

	BoardSize int `json:"boardSize"`
	ZoneRows  int `json:"zoneRows"`
	MaxTurns  int `json:"maxTurns"`
	MaxMisses int `json:"maxMisses"`
	RoundSecs int `json:"roundSeconds"`
}

func (d *Duel) duellistView(side game.Side) *DuellistView {
	x := d.of(side)
	if x == nil {
		return nil
	}
	v := &DuellistView{Name: x.Name, Level: x.Level, Power: x.Power, Missed: x.Missed}
	for _, sp := range x.Fleet {
		v.Fleet = append(v.Fleet, DuelShip{Key: sp.Key, Class: sp.Class, Name: sp.Name, Rarity: sp.Rarity, HP: sp.HP, Speed: sp.Speed})
	}
	switch d.Phase {
	case DuelPlacing:
		v.Ready = x.Placement != nil
	case DuelBattle:
		v.Ready = x.Pending != nil
	}
	return v
}

// View renders the duel for side; the opponent's deployment and orders stay hidden.
func (d *Duel) View(side game.Side, now time.Time) DuelView {
	v := DuelView{
		Code: d.Code, Phase: d.Phase, Rev: d.Rev, Host: side == game.SidePlayer,
		Me: *d.duellistView(side), Opponent: d.duellistView(side.Opponent()),
		Outcome:   d.Outcome(side),
		BoardSize: DuelSize, ZoneRows: DuelZoneRows, MaxTurns: DuelMaxTurns, MaxMisses: DuelMaxMisses,
		RoundSecs: int(DuelRoundTime / time.Second),
	}
	if d.Phase.Active() {
		v.SecondsLeft = max(int(d.Deadline.Sub(now).Seconds()+0.999), 0)
	}
	me := d.of(side)
	for _, p := range me.Placement {
		v.Placement = append(v.Placement, toSea(side, p))
	}
	if me.Pending != nil {
		a := *me.Pending
		if side == game.SideCPU {
			a = a.Mirror(DuelSize)
		}
		v.Pending = &a
	}
	if d.Game != nil {
		gv := d.Game.ViewFor(side)
		v.Game = &gv
	}
	return v
}
