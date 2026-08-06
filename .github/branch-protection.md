# Branch protection — RevelleBeauty-Backend

Branch protection is a repository **setting**, not a file, so it must be applied
once via the GitHub UI or API. The CI workflow exposes a single aggregate check
named **`CI OK`** — protect the default branch by requiring it.

## Option A — GitHub CLI (run once)

```bash
gh api -X PUT repos/FOFANA459-2023/RevelleBeauty-Backend/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": ["CI OK"] },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
EOF
```

(If the default branch is `master`, change the URL accordingly.)

## Option B — Web UI

Settings → Branches → Add branch protection rule for `main`:

- ✅ Require a pull request before merging (1 approval, dismiss stale)
- ✅ Require status checks to pass → search for and select **CI OK**
- ✅ Require branches to be up to date before merging
- ✅ Require conversation resolution before merging
- ✅ Do not allow bypassing the above settings
- ❌ Allow force pushes / deletions — leave off

The status check only appears in the picker after CI has run at least once —
push a commit or open a PR first, then add the rule.
