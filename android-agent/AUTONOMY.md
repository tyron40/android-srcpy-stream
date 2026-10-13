# Continuous Android AI mode

The dashboard includes an **Always-on mode** for each connected Android device. Set a standing instruction and choose an observation interval (15–3600 seconds), then click **Start continuous mode**. There is **no fixed session duration**. It continues until stopped, the backend shuts down, or the host is unavailable. Enabled sessions are restored when the Python server restarts.

The backend watches screenshots for changes, executes bounded visual AI cycles when the screen changes, and stores recent activity in `android-agent/agent_memory.sqlite3` (not in Git). The memory is used to reduce repetition; it is not model training. Error retries use exponential backoff. There are no built-in time limits, but the host must remain on, Android devices must stay authorized/connected, and OpenAI API usage is billed per call.

**Current boundaries:** The visual action executor supports taps, swipes, Home, Back and Done. It does not yet type text or send messages, and it is not a notification listener. The unattended supervisor intentionally rejects `allow_send_messages=true`. Message replies, app event subscriptions, contact allowlists, and outbound-message rate limits must be implemented and tested separately before enabling unsupervised messaging. This is not a guarantee of uninterrupted 24/7 operation.

Do not expose the dashboard's command endpoints publicly without authentication, authorization, and CSRF protection. Configure spending safeguards with your API provider; the current implementation does not enforce an API-cost budget.
