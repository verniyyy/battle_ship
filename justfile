# The commit being built, e.g. cbee965 (or cbee965-dirty with uncommitted
# changes). Every recipe exports it so builds and deploys stamp it into the
# API (/api/version) and the site (/version.json and the title screen).
export APP_VERSION := `git describe --always --dirty`

site := "https://battleship.verniyyy.workers.dev"

# List available recipes
default:
    @just --list

# Build images and start all services in the background
up:
    docker compose up -d --build

# Stop and remove the containers
down:
    docker compose down

# Run the browser end-to-end tests against the running stack (needs `just up`; run inside `nix develop`)
e2e *args:
    cd frontend && npx playwright test {{args}}

# Follow logs (optionally for one service)
logs *service:
    docker compose logs -f {{service}}

# Render the link-preview image (frontend/public/og.png) from scripts/og.html and the local portraits
og:
    google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1200,630 --allow-file-access-from-files --screenshot=frontend/public/og.png "file://{{justfile_directory()}}/scripts/og.html"

# Deploy the Go API to Vercel (production)
deploy-api:
    cd backend && npx vercel deploy --prod --yes --env APP_VERSION={{APP_VERSION}}

# Build the frontend and deploy it with the edge Worker to Cloudflare
deploy-web:
    cd edge && bun run deploy

# Deploy the API, then the site
deploy: deploy-api deploy-web

# Show which versions are deployed, next to the local one
versions:
    @echo "local {{APP_VERSION}}"
    @echo "web   $(curl -fsS {{site}}/version.json | sed -E 's/.*"version":"([^"]*)".*/\1/')"
    @echo "api   $(curl -fsS {{site}}/api/version | sed -E 's/.*"version":"([^"]*)".*/\1/')"
