# List available recipes
default:
    @just --list

# Build images and start all services in the background
up:
    docker compose up -d --build

# Stop and remove the containers
down:
    docker compose down

# Follow logs (optionally for one service)
logs *service:
    docker compose logs -f {{service}}

# Deploy the Go API to Vercel (production)
deploy-api:
    cd backend && npx vercel deploy --prod --yes

# Build the frontend and deploy it with the edge Worker to Cloudflare
deploy-web:
    cd edge && bun run deploy

# Deploy the API, then the site
deploy: deploy-api deploy-web
