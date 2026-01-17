# Learning Flow

How Sona learns from query outcomes.

## Trajectory Learning

```mermaid
flowchart TD
    A[Query executed] --> B[Create Trajectory]
    B --> C[Store: query + matches + scores]
    C --> D[Return trajectoryId]

    D --> E[User evaluates results]
    E --> F[god_learn called]
    F --> G[provideFeedback quality:0-1]

    G --> H{Quality > 0.5?}
    H -->|Yes| I[Positive gradient]
    H -->|No| J[Negative gradient]

    I --> K[EWC++ regularized update]
    J --> K

    K --> L[Update pattern weights]
    L --> M{Check drift}
    M -->|Critical| N[Suggest rollback]
    M -->|Normal| O[Continue]

    O --> P{Pattern success rate?}
    P -->|< 40%| Q[Auto-prune]
    P -->|> 80%| R[Auto-boost]
    P -->|Normal| S[Done]
```

## Feedback Loop

```mermaid
sequenceDiagram
    participant User
    participant Query as god_query
    participant Sona as SonaEngine
    participant Learn as god_learn

    User->>Query: Search memory
    Query->>Sona: Create trajectory
    Sona-->>Query: trajectoryId
    Query-->>User: Results + trajectoryId

    Note over User: Evaluate quality

    User->>Learn: Provide feedback
    Learn->>Sona: Update weights
    Sona->>Sona: EWC++ regularization
    Sona-->>Learn: Updated
```

## EWC++ Regularization

```mermaid
flowchart LR
    A[New Gradient] --> B[Fisher Information]
    B --> C[Importance Weights]
    C --> D{Important parameter?}
    D -->|Yes| E[Constrain update]
    D -->|No| F[Full update]
    E --> G[Apply small delta]
    F --> G
    G --> H[Updated Weights]
```

## Pattern Lifecycle

```mermaid
stateDiagram-v2
    [*] --> New: Pattern detected
    New --> Active: First success
    Active --> Boosted: >80% success rate
    Active --> Declining: <60% success rate
    Declining --> Pruned: <40% after 100 uses
    Boosted --> Active: Success rate drops
    Pruned --> [*]
```

## Quality Scores

| Score | Meaning | Action |
|-------|---------|--------|
| 0.0 | Completely useless | Strong negative gradient |
| 0.3 | Poor results | Negative gradient |
| 0.5 | Neutral | No change |
| 0.7 | Good results | Positive gradient |
| 1.0 | Perfect match | Strong positive gradient |

## Drift Detection

| Drift Level | Threshold | Action |
|-------------|-----------|--------|
| Normal | < 0.3 | Continue |
| Elevated | 0.3 - 0.5 | Log warning |
| Critical | > 0.5 | Suggest rollback |

## Related

- [System Architecture](system-architecture.md)
- [Learning Tools](../tools/learning-tools.md)
- [Sona Engine](../learning/sona-engine.md)
