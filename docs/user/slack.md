# Creating Tickets from Slack

Any Slack conversation about a facilities problem can become a ticket without leaving Slack.

## From a thread (the main way)

1. Hover any message in the thread → **⋮ (More actions) → Create facilities ticket**.
   (Slack doesn't allow slash commands inside threads — use the message menu.)
2. A dialog opens with a **draft ticket built from the thread**: if AI summarization is
   enabled, the title, description, suggested priority, and tags are pre-filled from what was
   discussed; otherwise the thread text is pasted in for you to trim.
3. **You review and edit everything** before anything is created — the AI only drafts.
4. Submit. The ticket lands in **Intake** for triage, and the bot confirms in the thread with
   a link. The ticket keeps a permalink back to the thread.

## By mentioning the bot

In a thread, `@FacilitiesBot create ticket P1 water leak near dock 3` creates the ticket
immediately and replies with the link: say `create ticket`, optionally a priority (P0/P1/P2 —
defaults to P2), then the ticket title. The thread text becomes the description as-is (no AI
summarization on this path — nobody would be reviewing it). If the bot can't parse the
mention, it replies with a usage hint.

## Notifications you'll get as DMs

- When a card you reported is verified and closed (with a link if it needs reopening).
- When a card assigned to you in *Waiting on Parts / Vendor* passes its expected-resume date.

## Notes

- Your Slack account is matched to your board account by email; if the bot says it doesn't
  know you, ask an admin to check your account email.
- The bot only reads threads where you explicitly invoke it, and it must be invited to
  private channels before it can be used there.
- Files attached in Slack are not copied to the ticket (v1) — the thread permalink keeps them
  one click away.
