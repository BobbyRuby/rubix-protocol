# /update-cloud — Deploy God-Agent to Cloud Servers

Deploy god-agent updates to remote cloud servers via SSH.

## Usage

- `/update-cloud` — Interactive server selection
- `/update-cloud all` — Update all configured servers

## Instructions

Follow these steps exactly:

1. **Read server configuration.** Read the file `.claude/cloud-servers.json` in the god-agent directory (`D:\rubix-protocol\.claude\cloud-servers.json`).

   If the file doesn't exist:
   - Tell the user: "No cloud servers configured. Create `.claude/cloud-servers.json` from the template at `.claude/cloud-servers.json.example`"
   - Show them the example format
   - Stop here

2. **Parse and display servers.** Parse the JSON and display a table:
   ```
   Cloud Servers:
   1. dev-server (user@192.168.1.10:/opt/god-agent) - Pre-phased-executor version
   2. prod-1 (deploy@prod.example.com:/home/deploy/god-agent) - Main production
   ```

3. **Handle "all" argument.** If the user invoked `/update-cloud all`:
   - Skip to step 5 with all servers selected
   - Confirm: "Updating ALL servers: dev-server, prod-1, ..."

4. **Ask which servers to update.** Use AskUserQuestion with multiSelect:
   - Question: "Which server(s) should be updated?"
   - Header: "Servers"
   - Options: One option per server with label=name and description="{host}:{path}"
   - multiSelect: true

5. **Deploy to each selected server.** For each selected server:
   - Announce: "Deploying to {name} ({host})..."
   - If server has `sshKey` field:
     - Run: `bash scripts/deploy-remote.sh {host} {path} -i {sshKey}`
   - Otherwise:
     - Run: `bash scripts/deploy-remote.sh {host} {path}`
   - Working directory must be `D:\rubix-protocol`
   - Capture output

   **Note:** For SSH keys with passphrases, users must run `ssh-add {sshKey}` before using `/update-cloud`.

6. **Report results.** Show a summary:
   ```
   Deployment Results:
   - dev-server: Success
   - prod-1: Failed - Connection refused
   ```

   Include any relevant output from failed deployments.

## Server Configuration Format

The `.claude/cloud-servers.json` file should contain:

```json
{
  "servers": [
    {
      "name": "server-name",
      "host": "user@hostname-or-ip",
      "path": "/absolute/path/to/god-agent",
      "sshKey": "~/.ssh/my_key",
      "notes": "Optional description"
    }
  ]
}
```

**Fields:**
- `name` (required): Short identifier for the server
- `host` (required): SSH host in format `user@hostname`
- `path` (required): Absolute path to god-agent on remote server
- `sshKey` (optional): Path to SSH private key file
- `notes` (optional): Description or reminders

**SSH Keys with Passphrases:**
If your key has a passphrase, add it to ssh-agent before deploying:
```bash
ssh-add ~/.ssh/my_key
```
