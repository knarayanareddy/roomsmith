SHELL := /bin/bash
PNPM := corepack pnpm

.PHONY: bootstrap setup dev lint typecheck test-unit test-contract test-integration test-e2e test-infra test-security build deploy evidence

bootstrap:
	corepack pnpm --version
	$(PNPM) install --frozen-lockfile

setup: bootstrap
	@test -f .env.local || cp .env.example .env.local
	@echo "Local fixture configuration ready. No Fire OS, companion, WebRTC, relay, or AWS service was started."

dev:
	$(PNPM) dev

lint:
	$(PNPM) lint

typecheck:
	$(PNPM) typecheck

test-unit:
	$(PNPM) test:unit

test-contract:
	$(PNPM) test:contract

test-security:
	$(PNPM) test:security

build:
	$(PNPM) build

test-integration:
	@echo "BLOCKED: native apps, WebRTC signaling, TURN, and signed content integration are not implemented." >&2
	@exit 1

test-e2e:
	@echo "BLOCKED: actual Fire TV/simulator and companion E2E paths are not implemented." >&2
	@exit 1

test-infra:
	@echo "BLOCKED: CDK/TURN infrastructure and infrastructure tests are not implemented." >&2
	@exit 1

deploy:
	@echo "BLOCKED: deployment is unavailable until infrastructure and native preflight exist." >&2
	@exit 1

evidence:
	@echo "Foundation only: no Fire TV, companion, playtest, perception, or release evidence. See docs/validation.md."
