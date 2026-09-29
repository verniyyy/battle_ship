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
