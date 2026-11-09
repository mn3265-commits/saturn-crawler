# saturn-crawler
Cloud half of the sponsorpath career crawl (2026-11-06). Public web only: company site -> careers page -> ATS board.
No logins, no personal data. The Mac pulls `data/crawled-boards.json`, `data/career-crawl-cache.json` and
`data/nyc-startup-universe.json` (scripts/cloud-crawl-sync.sh in sponsorpath) and runs startup-sweep locally.
Source of truth for the scripts is ~/Developer/sponsorpath/scripts; the sync copies them here.
