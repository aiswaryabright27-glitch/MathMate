# Security

Please do not report security vulnerabilities in public issues. Contact the repository owner privately through GitHub to coordinate a report and remediation.

## Protect credentials and local data

- Store provider credentials in the root `.env` file, which is excluded from Git.
- Never commit API keys, database files, recordings, or screenshots that may contain personal information.
- Rotate a key immediately if it is accidentally exposed.
- The development API binds to `127.0.0.1` by default in the documented command. Do not expose it to a public network without adding appropriate authentication and deployment security.
