# HomeWheel submission kit

## One-line pitch

HomeWheel lets wheelchair users negotiate a room layout with a browser agent:
the agent optimizes measurable circulation, while the person retains authority
over the lived details geometry cannot know.

## Short description

HomeWheel is a wheelchair-aware room planner built around a visible human-agent
negotiation. A person describes their mobility device, preferred clearance,
turning space, destinations, and furniture that must stay fixed. A WebMCP agent
reads the live room, simulates every route, identifies barriers, and proposes
exact furniture moves.

It is an independent personal project by Andrea Balbo.

Proposals are previews, never silent edits. The person can accept a plan or
reject it with feedback such as “the drawers must keep facing the bed.” That
feedback becomes structured context for the next agent proposal.

## Devpost description

### Inspiration

Room-layout advice often sounds simple: move a dresser, rotate a table, clear a
path. For someone who uses a wheelchair, however, a few centimeters can decide
whether a bed, desk, or storage area is usable. The technically shortest route
is not automatically the right answer. Daily routines, transfer sides, outlets,
light, reach, and personal preference matter too.

We wanted to build an agent experience where those lived constraints are not
treated as edge cases. They are the decision-making authority.

### Evidence-grounded user stories

The prototype includes composite user stories derived from public evidence,
not invented customer testimonials:

- A wheelchair user needs the bed-transfer side and furniture stability
  preserved, even if another arrangement produces a clear route.
- A person needs the simulation to use their actual chair and transfer
  technique because access needs are not one-size-fits-all.
- A person adapting their home needs authority over trade-offs involving
  independence, safety, reach, light, storage, and daily routines.

Those stories became testable requirements. HomeWheel now validates an explicit
approach zone at each transfer, work, or reach destination; calculates it from
the person’s movement profile; refuses to move stability-critical furniture;
and shares the person’s priorities with the agent before any proposal is
created.

Research basis:
[United Spinal’s accessible studio account](https://unitedspinal.org/accessibility-ideas-studio-apartment/),
[wheelchair transfer focus groups](https://pubmed.ncbi.nlm.nih.gov/25986519/),
and a
[qualitative study of home usability](https://pmc.ncbi.nlm.nih.gov/articles/PMC10792724/).

### What it does

HomeWheel gives a person and a browser agent the same editable floor plan. The
person sets a personal movement profile, marks required destinations and their
transfer, work, or reach zones, chooses what proposals should prioritize, and
protects furniture positions that matter. The agent can:

- read the complete room and personal constraints;
- simulate all required and optional routes;
- identify movable barriers;
- create an exact, collision-checked proposal;
- compare the proposal with the live layout; and
- restore a baseline or previous state.

Every proposal appears as a purple overlay with route evidence, exact moves,
and trade-offs. Nothing moves until the person clicks Accept. If the proposal
misses a lived detail, the person can reject it and explain why. The next agent
sees that feedback in the workspace state and can produce a targeted revision.

### How we used WebMCP

WebMCP is the bridge between agent reasoning and the application’s actual
state. HomeWheel registers eight tools directly from the page:
`get_workspace_state`, `set_mobility_profile`, `simulate_routes`,
`find_barriers`, `create_layout_proposal`, `set_object_constraint`,
`compare_layouts`, and `restore_layout`.

The key design choice is that the agent has a proposal tool, not an
“automatically rearrange my room” tool. WebMCP gives the agent precise
capabilities while the interface preserves human consent and makes every
change inspectable.

### How we built it

HomeWheel is a static Next.js and TypeScript application. It uses browser-side
A* pathfinding over an obstacle grid, personal clearance envelopes,
purpose-specific approach zones, collision-checked furniture geometry,
multi-destination metrics, and turning-space detection. State is shared between
direct manipulation and WebMCP tools, stored locally, and exportable as JSON.

### Challenges

The most important challenge was not pathfinding; it was deciding where agent
authority should stop. Direct mutation made the demo faster but weakened the
product. We redesigned the workflow around preview, explicit acceptance,
structured rejection, and feedback-aware revision.

We also had to make geometric evidence understandable without pretending it
was professional certification. HomeWheel clearly separates personal
simulation from building-code or medical claims.

### Accomplishments

- The agent and person operate on the same live room state.
- Locked human constraints are enforced at the tool-validation layer.
- Stability-critical furniture cannot be moved by the person or the agent
  without first releasing that protection.
- Transfer, work, and reach zones are visible and validated separately from the
  route leading to them.
- Personal priorities are part of live WebMCP state rather than hidden prompt
  context.
- A proposal cannot silently mutate the room.
- Rejection feedback persists and is available to the next agent turn.
- The prototype supports authored scenarios and fully editable rooms.
- Public evidence is visible inside the product without being presented as
  fabricated user validation.
- The complete experience works without a backend or user account.

### What we learned

Human-in-the-loop design becomes much more meaningful when feedback is part of
the tool state, not just a chat message. The agent can optimize geometry, but
the person defines what “better” means.

### What is next

A production version could add measured floor-plan import, richer door and wall
geometry, collaboration with occupational therapists, uncertainty ranges, and
optional checks against local accessibility guidance. Those features would
remain advisory and would continue to require real-world validation.

## Judging alignment

### WebMCP leverage

The agent needs structured access to exact geometry, constraints, routes,
history, and proposal validation. The core interaction would be unreliable as
plain text or screenshot reasoning.

### Execution

The prototype includes multi-route pathfinding, editable scenarios, collision
validation, human constraints, proposal overlays, persistent feedback, undo,
comparison, export, keyboard controls, and responsive design.

### Potential impact

The workflow gives disabled people a direct way to express movement needs and
correct an agent without surrendering control. The same consent pattern could
extend to workplace planning, aging in place, rehabilitation, and access
consultations.

### Creativity and ambition

The memorable interaction is not “AI rearranges furniture.” It is the moment
the person rejects a geometrically successful plan, teaches the agent what the
room means in daily life, and receives a better revision.

## Final video: 1 minute 12 seconds

The final narrated demo is `media/HomeWheel-WebMCP-Demo.mp4`. Its companion
caption file is `media/HomeWheel-WebMCP-Demo.srt`.

### 0:00–0:10 — The need

Show the blocked bedroom route and introduce the shared live floor plan.

### 0:10–0:24 — Personal authority

Show the wheelchair dimensions, required destinations, personal priorities,
and protected bed and desk.

### 0:24–0:34 — WebMCP proposal

Show the proposal overlay, exact dresser move, route evidence, and improvement
from one of two to two of two required routes.

### 0:34–0:43 — Human correction

Show the rejected proposal and the lived constraint:

> The dresser drawers must keep facing the bed, and I need the chair side to
> remain open.

### 0:43–0:56 — Feedback-aware revision

Show the feedback embedded in revision context and the revised proposal that
keeps the dresser orientation.

### 0:56–1:12 — Acceptance and proof

Show the accepted live layout, two reachable destinations, turning space,
activity history, and reversible decision.

## Exact demo prompts

### First proposal

> Read the HomeWheel workspace. Review every required destination and preserve
> every locked object and personal constraint. Find the main movable barrier,
> then create the smallest useful layout proposal for review. Do not alter the
> live room.

### Revision

> Read the updated HomeWheel workspace and the latest rejected-plan feedback.
> Create a revised proposal that explicitly responds to that feedback while
> preserving every locked object and clearing all required destinations.

## Recording checklist

- Use the Bedroom scenario and reset it immediately before recording.
- Keep browser zoom at 100%.
- Record at 1440p or 1080p with readable cursor movement.
- Show at least one real WebMCP tool invocation.
- Keep the video under three minutes and include clear spoken audio.
- Avoid claiming certification, medical advice, or universal accessibility.
- End on the accepted 2/2 layout or the clean initial state.

## Submission checklist

- [ ] Public live application URL
- [ ] Public source repository
- [x] Open-source license included
- [ ] Public YouTube demo with audio, under three minutes
- [ ] English Devpost description
- [ ] Screenshots showing initial, proposal, and accepted states
- [ ] Test the public URL in a fresh browser session
- [ ] Confirm all eight WebMCP tools are discoverable on the public URL
