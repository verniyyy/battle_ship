package meta

import (
	"errors"
	"math/rand/v2"
	"strings"
	"testing"
	"time"

	"github.com/verniyyy/battle_ship/backend/internal/game"
)

var t0 = time.Date(2026, 9, 28, 12, 0, 0, 0, JST)

func rng(seed uint64) *rand.Rand { return rand.New(rand.NewPCG(seed, 7)) }

func TestCatalogIsConsistent(t *testing.T) {
	seen := map[string]bool{}
	for _, c := range Cards {
		if seen[c.ID] {
			t.Errorf("duplicate card %s", c.ID)
		}
		seen[c.ID] = true
		if _, ok := game.ClassSkill[c.Class]; !ok || c.HP <= 0 || len(c.Home) == 0 {
			t.Errorf("card %s is incomplete", c.ID)
		}
	}
	for r := N; r <= UR; r++ {
		if len(cardsByRarity[r]) == 0 {
			t.Errorf("no %s cards", r)
		}
	}
	for _, s := range Stages {
		s.EnemySpecs() // panics on unknown keys
		if len(s.Enemies) > s.Size*s.Size || s.StarTurns >= s.MaxTurns {
			t.Errorf("stage %s is malformed", s.ID)
		}
	}
	for f := 1; f <= 40; f++ {
		s := EndlessStage(f)
		s.EnemySpecs()
		if s.Size > game.MaxBoardSize {
			t.Errorf("floor %d too large", f)
		}
	}
}

func TestNewProfileHasStarterFleet(t *testing.T) {
	p := NewProfile("p1", t0)
	if len(p.Ships) != 3 || len(p.Fleet) != 3 || p.Secretary == "" {
		t.Fatalf("bad starter profile: %+v", p)
	}
	specs := p.FleetSpecs()
	if specs[0].Class != game.Battleship || specs[2].Class != game.Submarine {
		t.Fatalf("unexpected fleet %v", specs)
	}
	if !p.Unlocked("1-1") || p.Unlocked("1-2") || p.Unlocked(EndlessID) {
		t.Fatal("only the first stage should be open")
	}
}

func TestSpecGrowsWithLevelAndStars(t *testing.T) {
	s := &OwnedShip{Card: "bb_kurogane", Level: 1}
	base := s.Spec()
	s.Level, s.Stars = 26, 5
	grown := s.Spec()
	if grown.HP != base.HP*1150/1000 || grown.Firepower <= base.Firepower || grown.Ammo != base.Ammo+1 ||
		grown.Skill != base.Skill+2 || grown.Crit != base.Crit+2+5 || grown.Speed != base.Speed || grown.Armor != base.Armor {
		t.Fatalf("base %+v grown %+v", base, grown)
	}
	if max := (&OwnedShip{Card: "bb_kurogane", Level: 50, Stars: 5}).Spec(); max.HP > base.HP*14/10 {
		t.Fatalf("a maxed ship should stay within reach of a fresh one: %d vs %d", max.HP, base.HP)
	}
}

func TestFreeTenThenPaidPulls(t *testing.T) {
	p := NewProfile("p1", t0)
	gems := p.Gems
	gains, err := p.Pull(10, rng(1), t0)
	if err != nil || len(gains) != 10 || p.Gems != gems {
		t.Fatalf("free ten: %v gems %d→%d", err, gems, p.Gems)
	}
	hasSR := false
	for _, g := range gains {
		hasSR = hasSR || g.Rarity >= SR
	}
	if !hasSR {
		t.Fatal("a 10-pull must contain an SR or better")
	}
	if _, err := p.Pull(1, rng(2), t0); err != nil || p.Gems != gems-PullCost {
		t.Fatalf("single pull: %v", err)
	}
	p.Gems = 10
	if _, err := p.Pull(1, rng(3), t0); !errors.Is(err, ErrInsufficient) {
		t.Fatalf("got %v, want ErrInsufficient", err)
	}
	if p.Daily.Progress[StatPulls] != 11 {
		t.Fatalf("daily pulls = %d", p.Daily.Progress[StatPulls])
	}
}

func TestPityGuaranteesSSR(t *testing.T) {
	p := NewProfile("p1", t0)
	p.Gacha.Pity = PityPulls - 1
	p.Gems = PullCost
	gains, err := p.Pull(1, rng(4), t0)
	if err != nil || gains[0].Rarity < SSR || p.Gacha.Pity != 0 {
		t.Fatalf("pity pull gave %+v (err %v)", gains, err)
	}
}

func TestDuplicatesLimitBreak(t *testing.T) {
	p := NewProfile("p1", t0)
	var g Gain
	for i := 0; i <= MaxStars; i++ {
		g = p.addCard("bb_kurogane", t0)
	}
	if g.New || g.Stars != MaxStars || g.Gems != OverflowGems || len(p.Ships) != 3 {
		t.Fatalf("got %+v with %d ships", g, len(p.Ships))
	}
}

func TestFleetAndTraining(t *testing.T) {
	p := NewProfile("p1", t0)
	if err := p.SetFleet([]string{p.Fleet[0], p.Fleet[0]}); !errors.Is(err, ErrInvalid) {
		t.Fatal("duplicate ships accepted")
	}
	if err := p.SetFleet([]string{"s1", "s2", "s3", "nope"}); !errors.Is(err, ErrInvalid) {
		t.Fatal("too many ships accepted at level 1")
	}
	if err := p.SetFleet([]string{"s3"}); err != nil {
		t.Fatal(err)
	}
	coins := p.Coins
	if n, err := p.Train("s3", 1, t0); err != nil || n != 1 || p.Ship("s3").Level != 2 || p.Coins != coins-LevelUpCost(1) {
		t.Fatalf("train: %d %v", n, err)
	}
	p.Coins = 0
	if _, err := p.Train("s3", 1, t0); !errors.Is(err, ErrInsufficient) {
		t.Fatal("training should cost coins")
	}
	// Training to the max stops where the coins run out...
	p.Coins = LevelUpCost(2) + LevelUpCost(3) + LevelUpCost(4) - 1
	if n, err := p.Train("s3", 0, t0); err != nil || n != 2 || p.Ship("s3").Level != 4 || p.Coins != LevelUpCost(4)-1 {
		t.Fatalf("train max: %d %v, level %d coins %d", n, err, p.Ship("s3").Level, p.Coins)
	}
	// ...or at the level cap.
	p.Coins = 1 << 30
	if n, err := p.Train("s3", 0, t0); err != nil || p.Ship("s3").Level != ShipMaxLevel(0) || n != ShipMaxLevel(0)-4 {
		t.Fatalf("train to cap: %d %v, level %d", n, err, p.Ship("s3").Level)
	}
	if _, err := p.Train("s3", 0, t0); !errors.Is(err, ErrInvalid) {
		t.Fatal("a capped ship trained further")
	}
}

func TestRename(t *testing.T) {
	p := NewProfile("p", t0)
	if !p.Unnamed {
		t.Fatal("a new admiral should be asked for a name")
	}
	if err := p.Rename("   ", ""); !errors.Is(err, ErrInvalid) || !p.Unnamed {
		t.Fatalf("a rejected first name registered the admiral: %v", err)
	}
	if err := p.Rename("  蒼海の提督  ", " よろしく "); err != nil || p.Name != "蒼海の提督" || p.Comment != "よろしく" {
		t.Fatalf("rename: %v %q %q", err, p.Name, p.Comment)
	}
	if p.Unnamed {
		t.Fatal("naming the admiral should register them")
	}
	for _, c := range []struct{ name, comment string }{
		{"   ", ""},
		{"あいうえおかきくけこさしす", ""}, // 13 characters
		{"提督", strings.Repeat("あ", MaxCommentLen+1)},
		{"提\n督", ""},
		{"提督", "改\x00行"},
	} {
		if err := p.Rename(c.name, c.comment); !errors.Is(err, ErrInvalid) {
			t.Errorf("Rename(%q, %q) = %v, want ErrInvalid", c.name, c.comment, err)
		}
	}
	if p.Name != "蒼海の提督" {
		t.Fatalf("a rejected rename changed the name to %q", p.Name)
	}
}

func TestLoginCycle(t *testing.T) {
	p := NewProfile("p1", t0)
	gems := p.Gems
	day, g, err := p.ClaimLogin(t0)
	if err != nil || day != 1 || p.Gems != gems+g.Gems {
		t.Fatalf("day %d %+v %v", day, g, err)
	}
	if _, _, err := p.ClaimLogin(t0.Add(time.Hour)); err == nil {
		t.Fatal("claimed twice in one day")
	}
	next := t0.Add(24 * time.Hour)
	for i := 2; i <= 8; i++ {
		day, _, err = p.ClaimLogin(next)
		if err != nil || day != (i-1)%7+1 {
			t.Fatalf("login %d: day %d %v", i, day, err)
		}
		next = next.Add(24 * time.Hour)
	}
}

func TestDailyMissionsResetAndClaim(t *testing.T) {
	p := NewProfile("p1", t0)
	if _, err := p.ClaimMission("d_sortie", t0); err == nil {
		t.Fatal("claimed an unfinished mission")
	}
	p.bump(t0, StatBattles, 3)
	if _, err := p.ClaimMission("d_sortie", t0); err != nil {
		t.Fatal(err)
	}
	if _, err := p.ClaimMission("d_sortie", t0); err == nil {
		t.Fatal("claimed twice")
	}
	tomorrow := t0.Add(24 * time.Hour)
	if v := p.View(tomorrow); v.Daily.Progress[StatBattles] != 0 || v.Daily.Claimed["d_sortie"] {
		t.Fatal("daily missions should reset")
	}
}

// playOut finishes a match with the player's ship 0 blasting every enemy.
func playOut(t *testing.T, m *Match, win bool) {
	t.Helper()
	st := m.Game
	if win {
		me := st.Boards[game.SidePlayer].Ships[0]
		for _, o := range st.Boards[game.SidePlayer].Ships[1:] {
			o.Pos = game.Pos{Row: -9, Col: -9 - o.ID} // out of the way
		}
		for _, s := range st.Boards[game.SideCPU].Ships {
			s.HP, s.Spec.Evasion = 1, 0
		}
		for _, s := range st.Boards[game.SideCPU].Ships {
			if !s.Alive() {
				continue
			}
			me.Pos = game.Pos{Row: s.Pos.Row, Col: s.Pos.Col + 1}
			if s.Pos.Col+1 >= st.Size {
				me.Pos.Col = s.Pos.Col - 1
			}
			me.Ammo = 9
			if _, err := st.Apply(game.SidePlayer, game.Action{Type: game.ActionAttack, ShipID: 0, Target: s.Pos}, rng(5)); err != nil {
				t.Fatal(err)
			}
		}
	} else {
		for _, s := range st.Boards[game.SidePlayer].Ships {
			s.Ammo, s.Torps, s.Skill = 0, 0, 0
		}
		st.Boards[game.SidePlayer].Ships[0].Ammo = 1
		ts := st.Boards[game.SidePlayer].AttackTargets(0)
		st.Gauge[game.SidePlayer] = 0
		for _, s := range st.Boards[game.SideCPU].Ships {
			s.Pos = game.Pos{Row: 50, Col: 50} // far away: no splash, no gauge
		}
		if _, err := st.Apply(game.SidePlayer, game.Action{Type: game.ActionAttack, ShipID: 0, Target: ts[0]}, rng(5)); err != nil {
			t.Fatal(err)
		}
	}
	if st.Status != game.StatusFinished || (st.Winner == game.SidePlayer) != win {
		t.Fatalf("status %s winner %s", st.Status, st.Winner)
	}
}

func newMatch(t *testing.T, p *Profile, stage string) *Match {
	t.Helper()
	m, err := NewMatch(p, stage, []game.Pos{{Row: 0, Col: 0}, {Row: 2, Col: 2}, {Row: 4, Col: 4}}, rng(9))
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestSettleWinPaysOnceAndUnlocksNext(t *testing.T) {
	p := NewProfile("p1", t0)
	if _, err := NewMatch(p, "1-2", nil, rng(1)); !errors.Is(err, ErrInvalid) {
		t.Fatal("locked stage accepted")
	}
	m := newMatch(t, p, "1-1")
	playOut(t, m, true)
	coins, gems := p.Coins, p.Gems
	rw := Settle(m, p, rng(1), t0)
	if !rw.Win || rw.Stars&1 == 0 || rw.NewStars&1 == 0 || rw.Coins <= 0 || rw.Gems < Stages[0].FirstGems {
		t.Fatalf("reward %+v", rw)
	}
	if p.Coins != coins+rw.Coins+levelUpBonusCoins(rw) || p.Gems != gems+rw.Gems+levelUpBonusGems(rw) {
		t.Fatalf("currencies not paid: coins %d→%d gems %d→%d (%+v)", coins, p.Coins, gems, p.Gems, rw)
	}
	if Settle(m, p, rng(1), t0) != rw || p.Stats.Wins != 1 {
		t.Fatal("settle must be idempotent")
	}
	if !p.Unlocked("1-2") {
		t.Fatal("clearing 1-1 should open 1-2")
	}
	if len(rw.Ships) != 3 || rw.Ships[0].Exp <= 0 {
		t.Fatalf("ship growth %+v", rw.Ships)
	}

	// A second clear pays no first-clear gems.
	m2 := newMatch(t, p, "1-1")
	playOut(t, m2, true)
	if rw2 := Settle(m2, p, rng(2), t0); rw2.NewStars&1 != 0 || rw2.Streak != 2 {
		t.Fatalf("second clear %+v", rw2)
	}
}

func levelUpBonusCoins(rw *Reward) int {
	if rw.LevelUp == nil {
		return 0
	}
	return rw.LevelUp.Coins
}

func levelUpBonusGems(rw *Reward) int {
	if rw.LevelUp == nil {
		return 0
	}
	return rw.LevelUp.Gems
}

func TestSettleLossBreaksStreak(t *testing.T) {
	p := NewProfile("p1", t0)
	p.Stats.Streak = 4
	m := newMatch(t, p, "1-1")
	playOut(t, m, false)
	rw := Settle(m, p, rng(1), t0)
	if rw.Win || rw.Rank != "E" || rw.Coins <= 0 || p.Stats.Streak != 0 || p.Stages["1-1"] != 0 {
		t.Fatalf("loss reward %+v", rw)
	}
	if len(rw.Chests) != 0 {
		t.Fatalf("a loss offered %d chests", len(rw.Chests))
	}
	if _, err := OpenChest(m, p, 0, t0); err == nil {
		t.Fatal("opened a chest after a loss")
	}
}

func TestChestsAreHiddenUntilOpened(t *testing.T) {
	p := NewProfile("p1", t0)
	m := newMatch(t, p, "1-1")
	playOut(t, m, true)
	Settle(m, p, rng(1), t0)
	pub := m.Reward.Public()
	for _, c := range pub.Chests {
		if c.Grant.Coins != 0 || c.Grant.Gems != 0 || len(c.Grant.Cards) != 0 || c.Tier != 0 {
			t.Fatal("chest contents leaked")
		}
	}
	coins, gems, ships := p.Coins, p.Gems, len(p.Ships)
	c, err := OpenChest(m, p, 1, t0)
	if err != nil {
		t.Fatal(err)
	}
	if p.Coins-coins != c.Grant.Coins || p.Gems-gems < c.Grant.Gems || (len(c.Grant.Cards) > 0 && c.Grant.Cards[0].UID == "" && len(p.Ships) == ships) {
		t.Fatalf("chest not paid: %+v", c)
	}
	if _, err := OpenChest(m, p, 0, t0); err == nil {
		t.Fatal("opened two chests")
	}
	if m.Reward.Public() != m.Reward {
		t.Fatal("opened chests should be public")
	}
}

func TestAchievementsClaim(t *testing.T) {
	p := NewProfile("p1", t0)
	if _, err := p.ClaimAchievement("a_wins_1"); err == nil {
		t.Fatal("unreached achievement claimed")
	}
	p.Stats.Wins = 1
	if p.View(t0).Badges.Achievements != 1 {
		t.Fatal("badge should show the claimable achievement")
	}
	if _, err := p.ClaimAchievement("a_wins_1"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.ClaimAchievement("a_wins_1"); err == nil {
		t.Fatal("claimed twice")
	}
}

func TestEndlessUnlocksAfterCampaign(t *testing.T) {
	p := NewProfile("p1", t0)
	p.Stages[Stages[len(Stages)-1].ID] = 1
	m := newMatch(t, p, EndlessID)
	if m.Stage.Floor != 1 {
		t.Fatalf("floor %d", m.Stage.Floor)
	}
	playOut(t, m, true)
	if rw := Settle(m, p, rng(1), t0); !rw.Record || p.Endless != 1 {
		t.Fatalf("endless reward %+v", rw)
	}
	if m := newMatch(t, p, EndlessID); m.Stage.Floor != 2 {
		t.Fatal("next sortie should go one floor deeper")
	}
}
