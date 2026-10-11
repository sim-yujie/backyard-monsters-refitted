# Security Policy

## Reporting a vulnerability

Please do not open a public issue. Email **simyujie@gmail.com** privately
instead, with:

- what the problem is and what someone could do with it,
- the steps to reproduce it (the request, page or endpoint involved),
- whether you checked it on a local copy or on the live game.

You should get a reply within a few days. Please give us a reasonable time to
fix the problem before you talk about it publicly.

## Test on your own copy

The live game at play.bymrevamped.com and its server at api.bymrevamped.com
have real players. Please do your testing on a local copy instead; the README
explains how to run one. Almost every kind of problem (logging in as someone
else, changing another player's yard, cheating the server's checks, injection)
shows up the same way locally.

If a problem only exists on the live servers (for example a misconfigured
proxy or certificate), send as few requests as you need to confirm it and
then stop and report it.

## What we look at

- The game server (`server/`) and its API
- The web client (`web/`) where a flaw affects other players or the server,
  such as account takeover, reading other players' data or getting around
  the server's save checks
- The website (`site/`)

## What we do not need

- Floods of traffic, stress tests or anything else that slows the game down
- Cheats that only change your own game in your own browser
- Automated scanner output without a working example
- Tricking players or staff

## Safe harbour

We will not take action against anyone who follows this policy in good faith:
test on a local copy, keep any live checks small, do not access other
players' data, do not harm the service and do not destroy data.

## Supported versions

Only the version currently running on play.bymrevamped.com (the `revamp`
branch) gets security fixes.
