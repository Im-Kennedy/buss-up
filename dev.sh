#!/bin/bash
# starts backend + frontend together. ctrl+c stops both.
cd "$(dirname "$0")"

# frontend needs node 20+, nvm defaults to old node
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"

# kill both children when this script exits
trap 'kill 0' EXIT

(cd backend && .venv/bin/python -m uvicorn main:app --reload) &
(cd frontend && npm run dev) &

wait
