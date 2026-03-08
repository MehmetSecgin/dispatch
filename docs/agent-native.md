# Agent-Native Design Principles

## Summary

`dispatch` is not just a CLI that agents can call.

The goal is to make it agent-native: discoverable, predictable, self-describing, and efficient for real autonomous use.

Humans still matter, but the primary operator model is:

- an agent discovers capabilities
- validates intent
- executes deterministically
- inspects artifacts
- asserts outcomes
- follows explicit next steps

## Core principle

Optimize for low-guessing loops.

A strong agent tool reduces uncertainty at every step. The agent should not need to infer hidden rules, scrape prose, or guess what comes next.

Good loop:

1. discover capabilities
2. validate inputs and dependencies
3. run
4. inspect outputs and artifacts
5. assert outcomes
6. follow `next[]`

Bad loop:

1. guess a command
2. parse ambiguous prose
3. hit an unclear error
4. guess again

## Design principles

### 1. Treat the agent as a compiler, not a human operator

Agents perform best when interfaces are:

- explicit
- enumerable
- typed
- inspectable
- consistent

Every major surface should answer:

- what can I do?
- what input shape is required?
- what failed?
- what should I do next?

### 2. Prefer stable machine contracts over prose

Human-readable output matters, but agents should not depend on English interpretation.

Priorities:

- stable `--json` output
- structured errors with machine-readable codes
- known exit semantics
- explicit `next[]` suggestions

English should explain the system, not carry the protocol.

### 3. Make every object self-describing

Jobs, modules, runs, memory, and dependencies should explain themselves with as little extra context as possible.

Examples:

- a job should declare dependencies explicitly
- a module should expose actions, shipped jobs, and seed jobs clearly
- a run result should distinguish runtime failure from assertion failure
- a missing dependency should explain both the problem and the fill path

### 4. Preserve deterministic state transitions

The CLI should behave like a predictable state machine.

Examples:

- unknown -> validated
- validated -> executed
- executed -> asserted
- missing dependency -> fillable dependency
- missing memory -> seed job available

Deterministic transitions are easier for agents to learn and recover from than loosely defined command behavior.

### 5. Keep same-run and cross-run state separate

Use:

- `step.*`
- `run.*`

for same-run data flow.

Use memory only for durable cross-run state.

This keeps jobs more portable, replayable, and predictable.

### 6. Prefer explicit dependencies over hidden prerequisites

If a job depends on modules or memory, it should say so.

The system should:

- validate dependencies before execution
- fail early when required state is missing
- suggest concrete recovery commands

Implicit prerequisites make agents brittle.

### 7. Make recovery mechanical

When something fails, the agent should know what to do next without improvisation.

Recovery surfaces should answer:

- is this a usage error, runtime error, or assertion failure?
- should this be retried?
- what command should run next?
- what artifact should be inspected?

### 8. Make successful behavior reusable

Successful runs should teach the system and future agents.

Examples of desirable future directions:

- synthesize reusable jobs from runs
- generate assertion drafts from observed outcomes
- derive capability cards from modules
- derive SKILL guidance from successful workflows

`dispatch` should not just execute work. It should help encode working patterns.

## Practical implications

When adding a feature, ask:

- can an agent discover this without reading source code?
- is the contract machine-readable?
- does the output tell the agent what to do next?
- does this reduce or increase hidden state?
- does this preserve replayability?
- does this separate setup from workflow execution clearly?

## Product posture

Think of `dispatch` as three products at once:

1. an execution engine
2. a machine protocol
3. a teaching system

The execution engine runs jobs.
The protocol makes behavior stable and automatable.
The teaching system helps agents understand how to use the engine well.

## Near-term priorities

Good next steps that align with this document:

- capability cards for modules and jobs
- `dispatch explain`
- artifact diffing
- memory snapshot export/import/diff
- richer structured error taxonomy
- planning mode with deterministic preflight

## Review checklist

Before merging a user-facing feature, ask:

- Is it discoverable by an agent?
- Is the machine output stable?
- Are dependencies explicit?
- Is recovery guidance concrete?
- Does it avoid hidden side effects?
- Does it preserve replayability and shareability?
- Does it make successful workflows easier to learn from?

