-- Read-only queries for the lead to run on LIVE with .claude/scripts/live-read.sh (one query per
-- call; no ';' inside a query, so each is separated by a blank line and has no trailing ';').
-- Checked for syntax on the helper's copy (battle_load_db). monster_usage only has rows from
-- patch 8.3 (23 Nov 2026) on. Nothing in the database records the "busy" refusal itself
-- (see the report: it is only in the container's stdout and, indirectly, in the JSON request log).

-- Q1. Per hour (SGT), last 4 days: Repeat attacks landed, hand attacks landed, players repeating.
select to_char(date_trunc('hour', landed_at at time zone 'Asia/Singapore'), 'MM-DD HH24') as hour_sgt, count(*) filter (where repeat) as repeats, count(distinct attacker_userid) filter (where repeat) as repeat_players, count(*) filter (where not repeat and mode = 'camp') as hand_camp, count(*) filter (where mode = 'player') as hand_player, count(*) filter (where arena in ('inferno', 'descent')) as inferno, count(*) filter (where not replayed) as not_replayed from bym.monster_usage where landed_at > now() - interval '4 days' group by 1 order by 1

-- Q2. The busiest 5-minute windows, last 4 days: Repeats and distinct players repeating at once
-- (the simulation's "players farming at once"), plus every other landing in the window.
select to_char(date_bin('5 minutes', landed_at, timestamptz '2026-01-01') at time zone 'Asia/Singapore', 'MM-DD HH24:MI') as window_sgt, count(*) filter (where repeat) as repeats, count(distinct attacker_userid) filter (where repeat) as repeat_players, count(*) filter (where not repeat) as other_landings from bym.monster_usage where landed_at > now() - interval '4 days' group by 1 order by repeats desc limit 25

-- Q3. Battle size: monsters flung per landing, Repeat vs hand, camp vs player (the bench used
-- 9-13 C12 for Repeat plans and 30 C14 + 2 champions for a player attack).
select repeat, mode, count(*) as landings, percentile_cont(0.5) within group (order by flung) as flung_p50, percentile_cont(0.95) within group (order by flung) as flung_p95, max(flung) as flung_max from (select repeat, mode, coalesce((select sum((v ->> 'f')::int) from jsonb_each(monsters) as e(k, v)), 0) as flung from bym.monster_usage where landed_at > now() - interval '4 days') as t group by 1, 2 order by 1, 2

-- Q4. Attacks on PLAYER yards started per hour (SGT), last 4 days. attack_logs is written by the
-- attack load only for player-owned yards (checked: 50+ Repeat attacks on camps in the helper's
-- copy wrote no row), so camps and Repeat attacks are NOT in it; use Q1 for those.
select to_char(date_trunc('hour', attacktime at time zone 'Asia/Singapore'), 'MM-DD HH24') as hour_sgt, type, count(*) as starts from bym.attack_logs where attacktime > now() - interval '4 days' group by 1, 2 order by 1, 2

-- Q5. Daily players and daily attacks/raids, last 14 days.
select day, active_players, attacks, tribe_raids, server_errors from bym.daily_stat order by day desc limit 14

-- Q6. How fast players chain Repeats: per player and hour, Repeats and the median gap between two
-- of their Repeats (the simulation assumes a press every 7-20 s after the answer). Busiest 20.
select u.username, to_char(date_trunc('hour', g.landed_at at time zone 'Asia/Singapore'), 'MM-DD HH24') as hour_sgt, count(*) as repeats, round(percentile_cont(0.5) within group (order by g.gap)) as median_gap_s from (select attacker_userid, landed_at, extract(epoch from landed_at - lag(landed_at) over (partition by attacker_userid order by landed_at)) as gap from bym.monster_usage where repeat and landed_at > now() - interval '4 days') as g join bym.user as u on u.userid = g.attacker_userid where g.gap is not null and g.gap < 600 group by 1, 2 order by 3 desc limit 20
