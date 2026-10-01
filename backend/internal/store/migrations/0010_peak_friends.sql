-- Friend achievements read the peak friend count from the profile
-- (meta.Stats.PeakFriends); start admirals befriended before it was kept at
-- the friends they have now.
UPDATE players p
SET profile = jsonb_set(p.profile, '{stats,peakFriends}', to_jsonb(f.n))
FROM (SELECT player_id, count(*) AS n FROM friends GROUP BY player_id) f
WHERE f.player_id = p.id;
