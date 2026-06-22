# Rotation

Rotation of secrets is a critical security practice to minimize the risk
of credential compromise. It is also a hard problem to solve in a
user-friendly way. This section explores the design and implementation
of secret rotation in jseeqret, including use cases, constraints, and
open questions.

## Assertion

> Rotating tokens and passwords seems to be the part where most systems
> fall apart, and where there are no standards or automation. Is this a
> correct assessment?

That assessment is partially correct. Rotation is a primary failure
point for many systems, but the claim that there are no standards or
automation is technically incorrect. Standards and automation do exist,
but they are unevenly applied, complex to implement, and often
fragmented by vendor lock-in.

The sections below explain why the assessment still holds up in
practice, despite the existence of tools.

## 1. Why Systems Fall Apart

You are correct that rotation is a frequent cause of outages. This
fragility comes from the gap between updating the secret, which is
relatively easy, and propagating it everywhere that depends on it,
which is much harder.

- **Dependency chains:** Rotation often breaks downstream systems that
  were never tracked. A database password change might succeed in the
  vault, but fail in a legacy cron job, a third-party SaaS integration,
  or a forgotten sidecar container, causing a silent partial outage.
- **Tight coupling:** Many applications are hard-coded to expect static
  credentials. Retrofitting them to accept dynamic, rotating secrets
  often requires code changes, such as restarting the app to read a new
  environment variable. Operationally, that looks like the system
  breaking during rotation.
- **The messy reality:** The control sounds simple in principle, but the
  operational reality includes certificate chains, embedded mobile
  integrations, and API keys that resist clean offboarding.

## 2. The State of Standards

There is no single universal standard for rotation. Instead, there is a
mix of legacy compliance requirements and newer security guidance that
often conflict with one another.

- **Human vs. machine split:**
  - **Human passwords:** Standards have effectively inverted. NIST and
    Microsoft now advise against mandatory rotation for humans, such as
    the old 90-day rule, because it often leads to weaker passwords.
    Many auditors, including PCI DSS and some insurers, still require
    it. That creates a compliance-versus-security conflict.
  - **Machine secrets:** For API keys and tokens, the prevailing
    guidance is aggressive rotation, often every 30 to 90 days or even
    more frequently.
- **Lack of interoperability:** There is no standard protocol, the way
  USB-C standardizes physical connectors, that lets a secret rotated in
  AWS Secrets Manager automatically update a service running in an
  on-prem Kubernetes cluster without custom glue code. That fragmented
  interface is likely what makes the space feel like it has no
  standards.

## 3. Automation Exists, but Is Not Automatic

The claim that there is no automation is false in terms of availability,
but understandable in terms of day-to-day friction.

- **The tooling gap:** Mature tools exist, including HashiCorp Vault,
  AWS Secrets Manager, CyberArk, and Doppler, that can automate large
  parts of secret rotation.
- **The implementation hurdle:** These tools are not plug-and-play.
  Adopting them often requires:
  - refactoring applications to fetch secrets through an API instead of
    static config files
  - building CI/CD pipelines that inject secrets safely
  - solving the "secret zero" problem, which is the initial credential
    needed to access the secret manager itself

## 4. How Automation Works in Practice

The most important distinction is that modern systems usually do not
"rotate a file in place" and hope every client notices. Instead, they
either issue short-lived credentials on demand, or they run a controlled
workflow that creates a new version, tests it, and then promotes it.

### HashiCorp Vault

Vault supports two automation patterns that are worth separating:

- **Dynamic secrets:** For systems such as databases, Vault can generate
	credentials on demand when a client asks for them. The returned secret
	comes with a lease, a TTL, and lease management operations such as
	renew and revoke. In practice, that means the application does not
	reuse one shared password forever. It asks Vault for a credential,
	uses it for a bounded period, and either renews it or requests a fresh
	one.
- **Managed rotation of static credentials:** Vault can also manage a
	known account, such as a database user, and rotate that password on a
	schedule or through an explicit operation. In that model, Vault stores
	the current password, updates it in the target system, and then serves
	the new value to authorized clients.

The main design idea in Vault is that the secret is coupled to a lease
lifecycle. Rotation is therefore less about replacing one permanent
value everywhere, and more about issuing credentials that expire fast
enough to reduce blast radius. This is one reason Vault works well for
machine-to-machine access: it turns rotation into continuous issuance
rather than a disruptive coordinated password-change event.

The catch is that clients must be built for that model. They need to
fetch secrets at runtime, handle renewals or re-reads, and survive the
transition when an old lease expires or is revoked.

### AWS Secrets Manager and AWS Credentials

AWS uses a different automation model. Instead of leading with leases,
Secrets Manager focuses on scheduled rotation and versioned secret
states.

- **Scheduled rotation:** A secret can be configured with a rotation
	schedule. On that schedule, AWS runs either a managed rotation flow or
	a custom Lambda rotation function.
- **Four-step workflow:** The rotation flow typically creates a pending
	secret, applies it to the target system, tests it, and then marks that
	version current. In AWS terms, the versions move through labels such
	as `AWSPENDING`, `AWSCURRENT`, and `AWSPREVIOUS`.
- **Version promotion instead of blind overwrite:** Because the new
	secret is staged before promotion, the system has a clearer handoff
	point than simply overwriting a value in place.

This model works well for database passwords, API tokens, and other
stored secrets, but it still assumes that applications know how to
reload the new value. If the application reads the secret once at boot
and never refreshes it, the rotation automation still causes an outage.

For AWS access itself, the preferred pattern is often to avoid rotating
long-lived access keys at all. Instead, workloads use IAM roles or
other AWS mechanisms that issue temporary security credentials. In that
setup, automation comes from credential expiration and re-issuance, not
from periodically changing one static access key pair. That is
operationally closer to Vault's short-lived lease model than to classic
password rotation.

### Why This Still Feels Hard

Both approaches automate the secret-management side, but neither removes
the integration burden from the application side.

- Vault reduces the lifetime of credentials, but clients must handle
	runtime fetch, caching, renewal, and revocation.
- AWS Secrets Manager can rotate on a schedule with clear versioning,
	but clients still need a reliable way to detect and adopt the new
	value.

That is the real source of friction. The secret manager can automate the
change, but only the surrounding system can automate safe adoption.

## Summary Verdict

| Claim | Accuracy | Context |
| --- | --- | --- |
| Where systems fall apart | Accurate | Rotation is a top cause of self-inflicted downtime because of untracked dependencies and tightly coupled legacy code. |
| No standards | Mixed | Standards exist, such as NIST and SOC 2 guidance, but they are often conflicting for human credentials and fragmented across vendors and deployment models. |
| No automation | Inaccurate | High-quality automation tools exist, but adoption stays low because implementation is complex and resource-intensive. |

## Additional Notes

The following notes appear to be pasted research material. They are kept
here, but reformatted into readable Markdown.

### Google Notes

Modern secrets automation works by shifting from static storage, such as
saving a password in a text file, to dynamic orchestration, where a
service fetches secrets on demand via an API.

To prevent systems from breaking, modern automation uses specific
architectural patterns to update, test, and distribute credentials
without human intervention.

### 1. The Core Architecture

Automation relies on a centralized, highly secure software broker
called a secret vault, such as HashiCorp Vault, AWS Secrets Manager, or
CyberArk. [1]

- **Centralized source:** Applications no longer hold passwords. They
	hold an identity token.
- **API-driven:** When an application needs to talk to a database, it
	asks the vault for the database password using its identity token.
- **Time-to-live (TTL):** Secrets are issued with an expiration date.
	When the timer runs out, the secret becomes useless.

### 2. The Mechanics of an Automated Rotation Cycle

When it is time to rotate a credential, such as every 30 days, the
automated system executes a multi-step workflow to prevent downtime.
[2]

```text
[Vault Engine] -> Generate New Password
							 -> Apply to Target System (e.g., Database)
							 -> Test Connection (Validation)
							 -> Update Application Access / Deprecate Old Secret
```

1. **Generation:** The vault securely generates a new, high-entropy
	 random password. No human ever sees it.
2. **Target update:** The vault uses a specialized plugin or software
	 driver to log into the target system, such as a PostgreSQL database,
	 and update the password there first.
3. **Validation:** The vault runs a test query using the new password to
	 confirm the target system accepted it.
4. **Propagation:** The vault updates its internal registry. The next
	 time the application requests the password, it receives the new one.

### 3. Advanced Automation Patterns

To eliminate the risk of a system breaking during a password swap,
engineers use several advanced automation techniques.

#### Pattern A: Dual-Credential Rotation

This is a common pattern for critical APIs and databases.

- The database is configured to accept two valid passwords at the same
	time, such as `User_Password_A` and `User_Password_B`.
- The vault rotates password B while the application is still actively
	using password A.
- Once password B is confirmed working, the vault instructs the
	application to switch to password B.
- After a safe waiting period, password A is deleted.

#### Pattern B: Dynamic / Just-In-Time Secrets

Instead of rotating an existing password, the vault creates a temporary
user account on the fly.

- An application requests database access.
- The vault instantly creates a brand-new user in the database, such as
	`app_user_tmp_9482`.
- The vault grants this temporary user strict permissions and a lifespan
	of one hour.
- After one hour, the vault automatically deletes the user account from
	the database.
- Result: there is no static password left behind to steal or rotate.

#### Pattern C: OIDC and Short-Lived Tokens

For cloud environments, some teams eliminate passwords using OpenID
Connect (OIDC).

- A workflow running in GitHub Actions needs to deploy code to AWS.
- Instead of saving an AWS access key in GitHub, GitHub issues a
	temporary cryptographic token proving its identity.
- AWS trusts GitHub, validates the token, and hands GitHub a temporary
	session key that expires in 15 minutes.
- Result: no passwords or tokens are ever stored anywhere.

### Possible Follow-Ups

- Explain how to handle the "secret zero" problem when authenticating to
	a vault.
- Show example code for how an application fetches a dynamic secret.
- Provide a comparison of AWS Secrets Manager and HashiCorp Vault.

### External References

1. <https://atv.peoplecert.org/automation-in-itsm-solutions/>
2. <https://www.cflowapps.com/procurement-automation/>

### GitLab Cron Job Question

> So, how would a cron job running `git pull`, where GitLab is set up
> with MFA and therefore needs a token to log in, trigger a token
> rotate?

To automate token rotation for a local cron job running `git pull`
against a multi-factor authenticated GitLab account, a common approach
is token self-rotation. [1]

Instead of generating a static token that lasts forever, you issue a
token with a short expiration date, such as seven days, and program the
cron script to use its current token to request its next token via the
[GitLab Personal Access Tokens API](https://docs.gitlab.com/api/personal_access_tokens/).
Because the API swap happens programmatically, it bypasses the
interactive MFA prompt required for human logins. [1, 2, 3, 4, 5]

### Step-by-Step Architecture for the Cron Job

To prevent the exact breaking points discussed earlier, the script must
handle several tasks sequentially: requesting the new token, updating
the local configuration, and revoking the old token. [6, 7]

```text
[Cron Trigger] -> Call GitLab API (Rotate Token)
							 -> Save New Token Locally
							 -> Verify `git pull` Works
							 -> Revoke Old Token
```

### 1. Set Up the Initial Token

You must manually generate the very first token in the
[GitLab token preferences panel](https://docs.gitlab.com/user/profile/personal_access_tokens/).
[8, 9]

- **Required scopes:** It must be granted `api` or `self_rotate`
	permissions.
- **Save location:** Store it in a local file on the cron server that
	only the cron user can read, such as `/home/cronuser/.gitlab_token`.
	[1]

### 2. The Automated Bash Script

Create a script, for example `/usr/local/bin/git_pull_rotate.sh`, that
manages both the repository sync and the automated rotation. [6, 7]

```bash
#!/bin/bash
set -e

TOKEN_FILE="/home/cronuser/.gitlab_token"
REPO_DIR="/path/to/your/local/repo"

# 1. Read the current token from the secure local file
CURRENT_TOKEN=$(cat "$TOKEN_FILE")

# 2. Call GitLab's self-rotation API endpoint to generate the next token
# This creates a new token valid for 7 days and returns JSON
RESPONSE=$(curl --silent --request POST \
	--header "PRIVATE-TOKEN: $CURRENT_TOKEN" \
	"https://gitlab.com")

# 3. Parse the new token from the JSON string
NEW_TOKEN=$(echo "$RESPONSE" | grep -o '"token":"[^"]*' | grep -o '[^"]*$')
if [ -z "$NEW_TOKEN" ]; then
		echo "Rotation failed: Could not retrieve a new token."
		exit 1
fi

# 4. Save the new token locally, overwriting the old one
echo "$NEW_TOKEN" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

# 5. Inject the token dynamically into Git for the pull execution
# This avoids hardcoding passwords inside the project's .git/config file
cd "$REPO_DIR"
git -c credential.helper= \
	pull https://oauth2:${NEW_TOKEN}@://gitlab.com main

echo "Rotation and sync successful."
```

### 3. Attach It to Your Cron Table

Open the crontab editor, `crontab -e`, under the specific service
account user execution context:

```cron
# Run every Monday at 2:00 AM
0 2 * * 1 /usr/local/bin/git_pull_rotate.sh >> /var/log/cron_git_pull.log 2>&1
```

### Why This Design Prevents System Outages

This specific setup directly mitigates the vulnerabilities where
automation normally breaks. [6]

- **Solves the "secret zero" catch-22:** Because GitLab supports the
	`/self/rotate` URL parameter, the script does not need a secondary
	master admin password to create user tokens. The token updates itself
	atomically. [1, 6]
- **Protects the local environment:** Using the
	`git -c credential.helper=` flag injects the authentication
	parameters strictly into the running memory of that specific command.
	The password is never logged to standard output or left cached inside
	a globally exposed plaintext file on the server filesystem. [7]
- **Graceful degradation:** Because the expiration is set to seven days
	but the cron job runs every seven days or less, a network error during
	rotation does not immediately break access. The prior token remains
	valid until the timeout threshold, giving you time to re-trigger the
	script manually before the actual cutoff. [6, 10]

### Alternatives

If you are open to alternatives, these options can remove local tokens
entirely:

- Show how to use SSH keys with passphrases instead of API tokens.
- Explain how to migrate this to a native GitLab CI/CD scheduled
	pipeline using project access tokens.
- Show how to implement a Git credential helper storage manager to
	isolate the variables.

### GitLab References

1. <https://docs.gitlab.com/api/personal_access_tokens/>
2. <https://www.youtube.com/watch?v=A9ONfnwswd0&t=17>
3. <https://gitlab.com/gitlab-org/gitlab/-/issues/241523>
4. <https://gitlab.com/gitlab-org/gitlab/-/issues/430748>
5. <https://docs.gitlab.com/security/tokens/>
6. <https://gitlab.com/gitlab-org/gitlab/-/issues/428256>
7. <https://gitlab.com/gitlab-com/cs-tools/gitlab-cs-tools/ci-cd-examples/scheduled-project-access-token-rotation>
8. <https://www.youtube.com/watch?v=w1vDFnHe3zM>
9. <https://docs.gitlab.com/user/profile/personal_access_tokens/>
10. <https://gitlab.com/gitlab-org/gitlab/-/issues/423362>

### FontAwesome Token Question

> How do I deal with systems like Font Awesome that only have a web API
> for creating tokens?

When dealing with services like Font Awesome that only provide a manual
web UI to generate long-lived tokens, you hit the exact wall that makes
secrets management so fragile. There is no `POST /tokens/rotate`
endpoint available to automate the swap programmatically. [1, 2]

To secure these un-automatable platforms, you must shift your strategy
from dynamic rotation to abstracted architecture.

#### Strategy 1: The Token Exchange Pattern

Fortunately, Font Awesome addresses this internally by separating your
permanent account API token from a short-lived session access token.
[3]

You should never bake your master account token directly into your
production application code or CI/CD scripts. Instead, treat your
master token as an offline root key, and dynamically fetch ephemeral
tokens via the
[Font Awesome token endpoint](https://docs.fontawesome.com/apis/graphql/token-endpoint).
[1, 3]

```text
[Your Application] -> Send Master Token -> [Font Awesome API]
[Your Application] <- Return 1-hour JWT  <- [Font Awesome API]
```

1. Store the master Font Awesome API token securely inside an
	 environment variable or local vault.
2. When your application boots up or builds, have it make an
	 authorization exchange request:

```bash
curl -H "Authorization: Bearer YOUR_LONG_LIVED_WEB_UI_TOKEN" \
	-X POST \
	https://api.fontawesome.com/token
```

3. Font Awesome returns a short-lived JWT access token that
	 automatically expires in 3,600 seconds, or one hour.
4. Your application uses that one-hour token to fetch metadata or
	 download Pro icons. Even if an attacker steals the running container
	 token, it becomes useless after 60 minutes. [1, 3, 4]

#### Strategy 2: Proxy Isolation

If you encounter a different web-only vendor that does not offer an
exchange endpoint, giving you only one static token that lasts forever,
you must isolate the token behind a reverse proxy. [5]

Instead of giving 50 different microservices or servers the static
token, you route all vendor traffic through a single internal API proxy.
[5]

```text
[Service A] --+
[Service B] ----> [Internal API Proxy] -> Inject Static Token -> [Web UI Vendor]
[Service C] --+
```

- **How it helps:** The static web UI token is saved in exactly one
	secure spot: your proxy gateway.
- **The rotation benefit:** When compliance demands a yearly rotation, a
	human must still log into the web UI to click Regenerate. However,
	instead of tracking down and breaking dozens of active application
	deployments, the human updates the token in one place, the proxy
	configuration, with zero production downtime. [5, 6]

#### Strategy 3: The Last Resort

When a vendor provides no API, requires frequent rotation, and has no
proxy alternatives, companies resort to robotic process automation.
Using a headless browser framework like Playwright or Puppeteer,
engineers write a script that runs on a secure cron server to mimic a
human:

1. The script launches a headless browser and navigates to the login
	 screen.
2. It inputs credentials stored securely in a vault.
3. If MFA is active, the script prompts a developer via Slack for the
	 TOTP code, or queries an automated authenticator API to resolve the
	 token.
4. It navigates the web UI DOM tree, clicks the Regenerate Token
	 button, parses the new plaintext token string from the page, and
	 pushes it directly into your secrets vault. [6]

Warning: this approach is highly brittle. The moment the vendor changes
their UI structure or button identifiers, the script breaks and requires
immediate maintenance.

#### Summary Architectural Choice

| If the service has... | Your best architectural move is... |
| --- | --- |
| Token exchange, such as Font Awesome | Keep the master token hidden and exchange it for one-hour dynamic JWTs at runtime. |
| Static token only | Route all calls through an internal proxy to limit exposure to a single endpoint. |
| No APIs and strict UI-only access | Use headless web automation such as Playwright to simulate a human clicking Reset. |

### Possible Solutions

If you want to build a solution for this pattern, possible next steps
include:

- Show a Python snippet to auto-refresh Font Awesome short-lived tokens.
- Explain how to build an Nginx proxy to inject static authorization
	headers.
- Discuss security strategies for handling third-party web hooks without
	APIs.

### Font Awesome References

1. <https://docs.fontawesome.com/web/dig-deeper/tokens>
2. <https://github.com/reductstore/reductstore/issues/1085>
3. <https://docs.fontawesome.com/apis/graphql/token-endpoint>
4. <https://fontawesome.com/docs/apis/graphql>
5. <https://www.youtube.com/watch?v=RNgmWHpPM3o>
6. <https://www.youtube.com/watch?v=A9ONfnwswd0&t=17>
