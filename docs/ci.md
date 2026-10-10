# Previews for pull requests

A CI job can give each pull request a Spawner preview environment: `spawner up pr-<number>` at each push, its URL in a comment, `spawner down` when it closes. This page has a GitHub Actions workflow that does it, and a GitLab CI equivalent for merge requests.

Spawner does not do it by itself yet: nothing watches the git host, so no environment starts when a pull request opens unless a job starts it.

## How it works

At each push to a pull request, the job checks the code out and runs `spawner up` from the checkout, as a developer does from a worktree:

```bash
spawner up pr-42 --wait --json
```

- The checkout is sent as an archive, the files git sees ([what is sent](cli.md#up)), and the server builds it: the CI runner needs Node.js and the CLI, not Docker.
- The environment is named explicitly: a CI checkout has a detached HEAD, with no branch to name it after.
- `--wait` returns once the environment is ready, after 30 minutes at most (`--timeout`). `--json` prints the result: `environment.url` is the entrypoint's URL, `environment.urls` every URL by exposure.
- The exit code says how it went: 0 ready, 4 failed, 5 still building, 6 quota or capacity reached, 7 `.spawner/` refused ([exit codes](cli.md#exit-codes)).

When the pull request is closed or merged, `spawner down pr-42` deletes the environment and its data.

## A CI account and its token

CI uses a personal API token, as an agent does. Give it an account of its own, so that its previews do not use up a person's quota, and show as "ci via github-actions" in the dashboard:

1. **Team**, **Invite**: who it is for ("CI"), role **Member**, **Create the link**. Open the link in a private window, name the account `ci` and create a passkey. Nobody needs to keep that passkey: an admin can send the account a link for a new one later (**Team**, the menu of the account, **Link for a new passkey**).
2. Still logged in as `ci`: **Account and tokens**, **API tokens**, **New token**. Name it after the CI (`github-actions`), keep only the scopes `envs:read` and `envs:write`, choose the project, and set an expiry, 365 days at most.
3. Copy the token, shown once, into a secret of the CI named `SPAWNER_TOKEN`.

The token reaches that project only, and without `envs:exec` it cannot run commands in environments. Add `preview` only if a later step calls the protected URLs, with `spawner url --with-token`. When the token expires, `spawner up` exits with code 3 (`unauthorized`): create the next one before, and replace the secret.

`spawner token create --scopes envs:read,envs:write --project blog`, from a login of `ci`, makes the same token, but it expires with that login at the latest, and `spawner logout` revokes it: for CI, use the dashboard.

### Quota, capacity and lifetime

- **Quota**: the CI account's environments count against its quota, 5 per person by default, sleeping ones included, across every project. With the default, a sixth open pull request gets no preview: `spawner up` exits with code 6 (`quota`), and the jobs below say so. Closing pull requests frees places, and an admin can raise **Environments per person** on the **Settings** page, for every account (0 for no limit).
- **Capacity**: a new preview also needs the memory and disk of one more environment of the project on the server (`spawner capacity`), or `spawner up` exits with code 6 (`capacity`).
- **Queued deploys**: an account may also have 5 deploys of uploaded code waiting to start. When builds queue on the server and more pull requests push at once, the next `spawner up` exits with code 6 (`quota`) until one starts: run the job again.
- **Lifetime**: a preview expires 72 hours after its last deploy by default (`ttl` in `spawner.yaml`, 14 days at most by default). A pull request without a push for longer loses its preview, and the next push creates a new one, with a new database. `--ttl 7d` on the `spawner up` line keeps it longer.
- **Sleep**: after 2 hours without activity, a preview sleeps; the next visit to one of its protected URLs wakes it up within seconds.

Previews belong to the CI account: teammates open them and read their logs and status, but only admins stop them, delete them, share them or run commands in them ([roles](concepts.md#accounts-and-roles)). Their URLs are protected like any other: a teammate logged in to the dashboard opens them, and for someone without an account, an admin creates a link on the environment's page (**Share**, **Create a link**).

## GitHub Actions

`.github/workflows/preview.yml`:

```yaml
name: Preview

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

concurrency:
  group: preview-${{ github.event.pull_request.number }}
  cancel-in-progress: false

permissions:
  contents: read
  pull-requests: write

env:
  SPAWNER_URL: https://spawner.preview.example.com
  SPAWNER_PROJECT: blog
  ENV_NAME: pr-${{ github.event.pull_request.number }}

jobs:
  deploy:
    if: >-
      github.event.action != 'closed' &&
      github.event.pull_request.head.repo.full_name == github.repository &&
      github.actor != 'dependabot[bot]'
    runs-on: ubuntu-latest
    timeout-minutes: 40
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npm install -g spawner-cli@2

      - name: Deploy the preview
        id: up
        env:
          SPAWNER_TOKEN: ${{ secrets.SPAWNER_TOKEN }}
        run: |
          code=0
          spawner up "$ENV_NAME" --wait --json > up.json || code=$?
          echo "code=$code" >> "$GITHUB_OUTPUT"

      - name: Comment on the pull request
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
          SHA: ${{ github.event.pull_request.head.sha }}
          CODE: ${{ steps.up.outputs.code }}
        run: |
          marker='<!-- spawner-preview -->'
          log="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
          if [ "$CODE" = 0 ]; then
            text="ready."$'\n\n'$(jq -r '.environment.urls
              | to_entries[] | "- \(.key): \(.value)"' up.json)
          else
            text="not ready, exit code $CODE ([log]($log))."$'\n\n'$(jq -r '
              (.error.message // .job.error // "still running on the server"),
              (.error.hint // empty)' up.json)
          fi
          body="$marker"$'\n'"Preview of ${SHA::7}: $text"
          comments="repos/$GITHUB_REPOSITORY/issues/$PR/comments"
          id=$(gh api --paginate "$comments" | jq -r --arg m "$marker" '.[]
            | select(.user.login == "github-actions[bot]")
            | select(.body | startswith($m)) | .id' | head -n 1)
          if [ -n "$id" ]; then
            gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" \
              -f body="$body" > /dev/null
          else
            gh api "$comments" -f body="$body" > /dev/null
          fi
          exit "$CODE"

  cleanup:
    if: >-
      github.event.action == 'closed' &&
      github.event.pull_request.head.repo.full_name == github.repository &&
      github.actor != 'dependabot[bot]'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npm install -g spawner-cli@2

      - name: Delete the preview
        env:
          SPAWNER_TOKEN: ${{ secrets.SPAWNER_TOKEN }}
        run: |
          code=0
          spawner down "$ENV_NAME" --json > down.json || code=$?
          error=$(jq -r '.error.code // empty' down.json)
          if [ "$code" -ne 0 ] && [ "$error" != not_found ]; then
            cat down.json
            exit "$code"
          fi
```

Set `SPAWNER_URL` to your dashboard's URL, and `SPAWNER_PROJECT` to the `project` of `spawner.yaml`: the cleanup job does not check the code out, so it names the project. Add the token as a repository secret (**Settings**, **Secrets and variables**, **Actions**). Pin the actions by commit SHA if you pin your others.

- **The comment**: the job keeps one comment per pull request, found by its hidden marker, and edits it at each push: the URLs when the preview is ready, the error and a link to the log of the run when it is not. The job then fails with `spawner`'s exit code, as a check of the pull request.
- **One run at a time** per pull request: a push while the preview builds waits for that run to end, and GitHub keeps only the latest waiting run. A deploy is never cut in the middle, and the preview ends up on the last commit, or deleted once the pull request is closed.
- **What is deployed**: `actions/checkout` checks out the pull request merged into its base branch (`refs/pull/<number>/merge`), so the preview shows what merging would give. With `ref: ${{ github.event.pull_request.head.sha }}` under its `with:`, it deploys the branch alone.
- **A monorepo**: run `spawner up` in the directory holding `.spawner/` (`working-directory: apps/blog` on the step), which is the project's **Directory** in the dashboard.
- **Other repositories** of `spawner.yaml` (`sources`) come from git at their `default_ref`; `--ref front=<branch>` on the `spawner up` line picks another branch.
- **The CLI's version**: `spawner-cli@2` installs the latest 2.x. To match the server exactly, give its version (`spawner-cli@2.1.0`), or download the server's own copy from `$SPAWNER_URL/api/v1/cli/spawner` ([versions](cli.md#versions-and-updates)). `npx --yes spawner-cli@2 up ...` works without the install step.

### Pull requests from forks

The workflow runs on `pull_request`, and only for the branches of the repository itself:

- GitHub gives no secrets to the workflows of pull requests from forks, so they would have no token: the `if:` skips their jobs rather than failing them. The runs Dependabot triggers get only Dependabot secrets, and are skipped the same way.
- Never switch to `pull_request_target` to get the secrets with a checkout of the pull request's code: that runs a stranger's code with your secrets and write access to the repository. A preview also runs the code of its branch on your server, with the project's variables, and the outbound traffic of environments is not filtered ([security](security.md#what-spawner-does-not-do-yet)): the code of a fork could send them anywhere.
- A maintainer who has read the change can start its preview by hand: `gh pr checkout 42`, then `spawner up pr-42 --wait`. That preview belongs to the maintainer: delete it with `spawner down pr-42` when the pull request closes, or let it expire.

## GitLab CI

`.gitlab-ci.yml`, for merge request pipelines:

```yaml
stages: [preview]

variables:
  SPAWNER_URL: https://spawner.preview.example.com
  SPAWNER_PROJECT: blog
  ENV_NAME: mr-$CI_MERGE_REQUEST_IID

.spawner:
  stage: preview
  image: node:22
  resource_group: preview-mr-$CI_MERGE_REQUEST_IID
  before_script:
    - npm install -g spawner-cli@2

preview:
  extends: .spawner
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event" && $SPAWNER_TOKEN
  script:
    - |
      code=0
      spawner up "$ENV_NAME" --wait --json > up.json || code=$?
      node -p 'require("./up.json").environment?.url ?? ""' |
        sed 's/^/PREVIEW_URL=/' > deploy.env
      exit "$code"
  artifacts:
    reports:
      dotenv: deploy.env
  environment:
    name: review/mr-$CI_MERGE_REQUEST_IID
    url: $PREVIEW_URL
    on_stop: preview-stop

preview-stop:
  extends: .spawner
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event" && $SPAWNER_TOKEN
      when: manual
  allow_failure: true
  variables:
    GIT_STRATEGY: none
  script:
    - |
      code=0
      spawner down "$ENV_NAME" --json > down.json || code=$?
      if [ "$code" -ne 0 ] && ! grep -q '"not_found"' down.json; then
        cat down.json
        exit "$code"
      fi
  environment:
    name: review/mr-$CI_MERGE_REQUEST_IID
    action: stop
```

- **The URL**: the `deploy.env` report gives the environment `review/mr-<iid>` its URL, which the merge request shows. The job fails with `spawner`'s exit code when the preview does.
- **The end**: when the merge request is merged or closed, GitLab runs `preview-stop`, which deletes the preview. The environment's stop button runs it too.
- **One job at a time** per merge request: `resource_group` makes a stop wait for a running deploy, and a deploy for the one before.
- **The token**: a CI/CD variable `SPAWNER_TOKEN` (**Settings**, **CI/CD**, **Variables**), with the visibility **Masked and hidden**. Leave **Protect variable** unchecked, unless your project lets merge request pipelines read protected variables: these pipelines run on branches that are not protected. Whoever can push a branch can then use the token in a pipeline, which is why it reaches one project, without `envs:exec`.
- **Forks**: the pipeline of a merge request from a fork runs in the fork, without the project's variables: `$SPAWNER_TOKEN` is empty, and the rules leave the preview out. A member of the project who has read the change can run the pipeline in the project instead (the merge request's **Pipelines** tab, **Run pipeline**, after GitLab's warning): it then gets a preview like any other.
