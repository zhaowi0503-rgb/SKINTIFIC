# GitHub Actions Dispatcher

This Cloud Run Job gives the Marketplace sales report a reliable Google Cloud
Scheduler trigger while keeping GitHub Actions as the report executor.

The job calls `workflow_dispatch` for `marketplace-sales-report.yml` in
`scheduled` mode. The GitHub token is injected from Secret Manager and is never
stored in the image, Scheduler job, repository, or logs.

Production schedules use `Asia/Shanghai`:

- `marketplace-sales-report-primary`: 19:58, Monday through Friday.
- `marketplace-sales-report-backup`: 20:10, Monday through Friday.

The publisher persists notification state in Cloud Storage, so the backup
trigger does not duplicate notifications when the primary run succeeds.
