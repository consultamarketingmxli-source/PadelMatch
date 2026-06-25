"""Services subpackage for PadelAppRetas backend.

Modular Clean Architecture:
  - email_service      → Resend transactional emails
  - push_service       → Emergent-managed push notifications
  - jobs_worker        → MongoDB-backed persistent job queue (TTL timers)
"""
