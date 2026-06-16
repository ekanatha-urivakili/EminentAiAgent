#!/usr/bin/env bash
# Ingest Indeed jobs into EminentAiAgent, then trigger a fresh search.
# Usage: bash scripts/ingest_indeed.sh
# The API must be running on http://127.0.0.1:5210

set -euo pipefail

BASE="http://127.0.0.1:5210"

echo "→ Ingesting Indeed jobs into EminentAiAgent…"
curl -s -X POST "$BASE/api/jobs/ingest_indeed" \
  -H "Content-Type: application/json" \
  -d '{
    "clearFirst": true,
    "jobs": [
      {
        "jobId": "JOBSEARCH_1",
        "title": "Senior Software Engineer (Back-End)",
        "company": "CGI",
        "location": "United Kingdom",
        "url": "https://to.indeed.com/aavg4llqszwq",
        "employmentType": "Permanent",
        "workMode": "Office",
        "salaryMin": null, "salaryMax": null,
        "dayRateMin": null, "dayRateMax": null,
        "contractMonths": null,
        "description": "Senior Back-End Software Engineer role at CGI."
      },
      {
        "jobId": "JOBSEARCH_2",
        "title": "Senior Software Engineer",
        "company": "UNiDAYS",
        "location": "London",
        "url": "https://to.indeed.com/aa46xylmz9ph",
        "employmentType": "Permanent",
        "workMode": "Hybrid",
        "salaryMin": null, "salaryMax": null,
        "dayRateMin": null, "dayRateMax": null,
        "contractMonths": null,
        "description": "Senior Software Engineer at UNiDAYS, London."
      },
      {
        "jobId": "JOBSEARCH_3",
        "title": "Backend Software Engineer C# .Net SQL - Sports Trading",
        "company": "Client Server",
        "location": "London",
        "url": "https://to.indeed.com/aagnsjdljqp2",
        "employmentType": "Permanent",
        "workMode": "Office",
        "salaryMin": null, "salaryMax": null,
        "dayRateMin": null, "dayRateMax": null,
        "contractMonths": null,
        "description": "C# .NET SQL backend engineer for sports trading platform."
      },
      {
        "jobId": "JOBSEARCH_5",
        "title": "Senior Software Engineer .Net Python SQL - FTC",
        "company": "Client Server",
        "location": "London",
        "url": "https://to.indeed.com/aabr8crtd4hr",
        "employmentType": "Contract",
        "workMode": "Hybrid",
        "salaryMin": null, "salaryMax": null,
        "dayRateMin": null, "dayRateMax": null,
        "contractMonths": null,
        "description": "Senior .NET Python SQL engineer, fixed-term contract."
      },
      {
        "jobId": "JOBSEARCH_6",
        "title": "Senior C# Developer - Sports Trading",
        "company": "Client Server",
        "location": "London",
        "url": "https://to.indeed.com/aadn9mf6sxz8",
        "employmentType": "Permanent",
        "workMode": "Office",
        "salaryMin": null, "salaryMax": null,
        "dayRateMin": null, "dayRateMax": null,
        "contractMonths": null,
        "description": "Senior C# .NET developer for sports trading systems."
      },
      {
        "jobId": "JOBSEARCH_7",
        "title": ".NET Developer",
        "company": "Noir",
        "location": "London",
        "url": "https://to.indeed.com/aasvnwrlcstb",
        "employmentType": "Permanent",
        "workMode": "Hybrid",
        "salaryMin": null, "salaryMax": null,
        "dayRateMin": null, "dayRateMax": null,
        "contractMonths": null,
        "description": ".NET Developer position at Noir, London."
      },
      {
        "jobId": "JOBSEARCH_10",
        "title": "C#/OO Software Engineer",
        "company": "Redhorse International",
        "location": "London",
        "url": "https://to.indeed.com/aakpswr7nfnd",
        "employmentType": "Permanent",
        "workMode": "Hybrid",
        "salaryMin": null, "salaryMax": null,
        "dayRateMin": null, "dayRateMax": null,
        "contractMonths": null,
        "description": "C# object-oriented software engineer at Redhorse International."
      },
      {
        "jobId": "JOBSEARCH_15",
        "title": "Software Developer (Artificial Intelligence)",
        "company": "Oxford Economics",
        "location": "Remote",
        "url": "https://to.indeed.com/aask6m49b2w7",
        "employmentType": "Permanent",
        "workMode": "Remote",
        "salaryMin": null, "salaryMax": null,
        "dayRateMin": null, "dayRateMax": null,
        "contractMonths": null,
        "description": "AI-focused software developer at Oxford Economics, fully remote."
      }
    ]
  }' | python3 -m json.tool

echo ""
echo "→ Checking source health…"
curl -s "$BASE/api/jobs/sources/health" | python3 -c "
import json, sys
sources = json.load(sys.stdin)
for s in sources:
    status = 'READY' if s['ready'] else 'NOT READY'
    buf = f\"  ({s['bufferedJobs']} buffered)\" if s.get('bufferedJobs', 0) > 0 else ''
    print(f\"  {s['source']:18} {status}{buf}\")
"

echo ""
echo "✓ Done — refresh http://localhost:5173 to see updated results."
