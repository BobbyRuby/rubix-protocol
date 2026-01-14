# RUBIX Full-Scale Test Plan

## Overview

**Total Tools:** 110+
**Categories:** 28
**Estimated Duration:** 2-3 hours full coverage

---

## Test Categories

### 1. Memory Core (12 tools) - CRITICAL
| Tool | Test | Expected |
|------|------|----------|
| `god_store` | Store a test entry | Returns ID, compressed |
| `god_query` | Query for test entry | Finds entry with score |
| `god_trace` | Trace entry lineage | Returns L-Score, depth |
| `god_causal` | Create causal link | Links two entries |
| `god_find_paths` | Find path between entries | Returns path if exists |
| `god_stats` | Get memory stats | Returns counts, avg L-Score |
| `god_edit` | Edit test entry | Updates content/tags |
| `god_delete` | Delete test entry | Removes entry (confirm) |
| `god_checkpoint` | Create DB checkpoint | Creates backup file |
| `god_shadow_search` | Find contradictions | Returns contradictions |
| `god_cleanup_expired` | Clean expired relations | Reports cleaned count |

### 2. Learning System (3 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_learn` | Provide feedback on query | Updates trajectory |
| `god_learning_stats` | Get learning stats | Returns patterns, drift |
| `god_prune_patterns` | Prune low-success patterns | Reports pruned count |

### 3. GNN Enhancement (4 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_enhance` | Enhance single entry | Returns enhanced embedding |
| `god_enhance_batch` | Enhance multiple entries | Returns batch stats |
| `god_gnn_stats` | Get GNN stats | Returns cache stats |
| `god_clear_gnn_cache` | Clear GNN cache | Reports cleared count |

### 4. Routing (5 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_route` | Route a query | Returns recommended route |
| `god_route_result` | Record route result | Updates circuit breaker |
| `god_routing_stats` | Get routing stats | Returns route counts |
| `god_circuit_status` | Get circuit status | Shows all circuit states |
| `god_reset_circuit` | Reset circuits | Clears failure history |

### 5. Scheduler (7 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_schedule` | Schedule a task | Returns task ID |
| `god_trigger` | Trigger task/event | Executes task |
| `god_tasks` | List tasks | Returns task list |
| `god_pause` | Pause task | Task status = paused |
| `god_resume` | Resume task | Task status = pending |
| `god_cancel` | Cancel task | Task status = cancelled |
| `god_scheduler_stats` | Get scheduler stats | Returns task counts |

### 6. Playwright/Browser (8 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_pw_launch` | Launch browser | Returns session ID |
| `god_pw_close` | Close browser | Session closed |
| `god_pw_navigate` | Navigate to URL | Returns page title |
| `god_pw_screenshot` | Take screenshot | Returns screenshot path |
| `god_pw_action` | Perform action | Action completed |
| `god_pw_assert` | Assert element state | Assertion result |
| `god_pw_console` | Get console logs | Returns logs/errors |
| `god_pw_verify` | Quick verification | Returns verification result |

### 7. Codex/Task Executor (7 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_codex_do` | Submit task | Returns task ID |
| `god_codex_status` | Get status | Returns progress |
| `god_codex_answer` | Answer escalation | Resolves escalation |
| `god_codex_decision` | Answer decision | Resolves decision |
| `god_codex_cancel` | Cancel task | Task cancelled |
| `god_codex_log` | Get work log | Returns full log |
| `god_codex_wait` | Extend timeout | Timeout extended |

### 8. Collaborative Partner (3 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_partner_config` | Configure partner | Settings updated |
| `god_partner_challenge` | Challenge approach | Returns assessment |
| `god_partner_status` | Get partner status | Returns config |

### 9. Containment (6 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_containment_check` | Check path access | Returns allowed/denied |
| `god_containment_config` | Configure containment | Settings updated |
| `god_containment_add_rule` | Add rule | Rule added |
| `god_containment_remove_rule` | Remove rule | Rule removed |
| `god_containment_status` | Get status | Returns rules |
| `god_containment_session` | Manage session access | Access granted/revoked |

### 10. LSP (5 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_lsp_start` | Start LSP | Server initialized |
| `god_lsp_stop` | Stop LSP | Server stopped |
| `god_lsp_definition` | Go to definition | Returns location |
| `god_lsp_references` | Find references | Returns locations |
| `god_lsp_diagnostics` | Get diagnostics | Returns errors/warnings |
| `god_lsp_symbols` | Search symbols | Returns symbol list |

### 11. Git (5 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_git_blame` | Get blame info | Returns line authors |
| `god_git_bisect` | Binary search commit | Finds breaking commit |
| `god_git_history` | Get commit history | Returns commits |
| `god_git_diff` | Get diff | Returns changes |
| `god_git_branches` | List branches | Returns branch list |

### 12. AST (4 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_ast_parse` | Parse file | Returns AST |
| `god_ast_query` | Query AST | Returns matching nodes |
| `god_ast_refactor` | Refactor code | Code transformed |
| `god_ast_symbols` | Get symbols | Returns function/class list |

### 13. Analysis (4 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_analyze_lint` | Run ESLint | Returns lint errors |
| `god_analyze_types` | Run TypeScript check | Returns type errors |
| `god_analyze_deps` | Build dependency graph | Returns graph |
| `god_analyze_impact` | Analyze change impact | Returns affected files |

### 14. Debug (5 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_debug_start` | Start debug session | Session started |
| `god_debug_stop` | Stop debug session | Session stopped |
| `god_debug_breakpoint` | Set breakpoint | Breakpoint set |
| `god_debug_step` | Step through code | Execution advanced |
| `god_debug_eval` | Evaluate expression | Returns value |

### 15. Stack (2 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_stack_parse` | Parse stack trace | Returns frames |
| `god_stack_context` | Get error context | Returns surrounding code |

### 16. Database (2 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_db_schema` | Get DB schema | Returns tables/columns |
| `god_db_types` | Generate TypeScript types | Returns interfaces |

### 17. Profiler (3 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_profile_start` | Start profiling | Profiling started |
| `god_profile_stop` | Stop profiling | Returns profile data |
| `god_profile_hotspots` | Analyze hotspots | Returns slowest functions |

### 18. Documentation (2 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_docs_fetch` | Fetch docs from URL | Returns cached docs |
| `god_docs_search` | Search docs | Returns matching docs |

### 19. Wolfram Alpha (4 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_wolfram_query` | Query Wolfram | Returns result |
| `god_wolfram_calculate` | Calculate expression | Returns value |
| `god_wolfram_solve` | Solve equation | Returns roots |
| `god_wolfram_convert` | Convert units | Returns converted value |

### 20. Capabilities (1 tool)
| Tool | Test | Expected |
|------|------|----------|
| `god_capabilities_status` | Get capabilities status | Returns enabled/disabled |

### 21. Code Review (4 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_review` | Full code review | Returns issues |
| `god_quick_review` | Quick pre-commit check | Returns pass/fail |
| `god_security_review` | Security scan | Returns vulnerabilities |
| `god_review_config` | Configure review | Settings updated |

### 22. Notifications (6 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_notify` | Send notification | Notification sent |
| `god_notify_slack` | Configure Slack | Settings updated |
| `god_notify_discord` | Configure Discord | Settings updated |
| `god_notify_preferences` | Set preferences | Preferences updated |
| `god_notify_test` | Test notifications | Test sent |
| `god_notify_history` | Get history | Returns sent notifications |

### 23. Deep Work (6 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_deepwork_start` | Start deep work session | Session started |
| `god_deepwork_pause` | Pause session | Session paused |
| `god_deepwork_resume` | Resume session | Session resumed |
| `god_deepwork_status` | Get status | Returns progress |
| `god_deepwork_log` | Get work log | Returns activities |
| `god_deepwork_checkpoint` | Create checkpoint | Checkpoint saved |

### 24. Configuration (5 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_config_get` | Get configuration | Returns current config |
| `god_config_set` | Set configuration | Config updated |
| `god_config_load` | Load from file | Config loaded |
| `god_config_save` | Save to file | Config saved |
| `god_config_reset` | Reset to defaults | Config reset |

### 25. Failure Memory (4 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_failure_record` | Record failure | Failure stored |
| `god_failure_query` | Query similar failures | Returns matches |
| `god_failure_resolve` | Mark failure resolved | Resolution recorded |
| `god_failure_stats` | Get failure stats | Returns breakdown |

### 26. Communications (2 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_comms_setup` | Configure comms | Settings updated |
| `god_comms_escalate` | Manual escalation | Escalation sent |

### 27. Curiosity System (4 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_curiosity_list` | List probes | Returns probes |
| `god_curiosity_explore` | Explore probe | Exploration started |
| `god_budget_status` | Get budget status | Returns remaining |
| `god_budget_history` | Get history | Returns explorations |

### 28. Compression (6 tools)
| Tool | Test | Expected |
|------|------|----------|
| `god_store_compressed` | Store with compression | Entry compressed |
| `god_query_expanded` | Query with expansion | Results expanded |
| `god_self_query` | Query self-knowledge | Returns RUBIX knowledge |
| `god_compression_stats` | Get compression stats | Returns ratios |
| `god_bootstrap_status` | Check bootstrap | Returns status |
| `god_recompress_all` | Compress all entries | Entries compressed |

---

## Test Execution Order

### Phase 1: Core Memory (Foundation)
1. god_stats - Baseline
2. god_store - Create test entry
3. god_query - Verify retrieval
4. god_edit - Modify entry
5. god_trace - Check lineage
6. god_causal - Create relationships
7. god_find_paths - Verify paths
8. god_shadow_search - Test contradictions
9. god_cleanup_expired - Housekeeping
10. god_checkpoint - Backup

### Phase 2: Learning & Intelligence
11. god_route - Test routing
12. god_route_result - Record results
13. god_routing_stats - Verify stats
14. god_circuit_status - Check circuits
15. god_reset_circuit - Reset state
16. god_learn - Provide feedback
17. god_learning_stats - Check learning
18. god_prune_patterns - Test pruning

### Phase 3: GNN Enhancement
19. god_gnn_stats - Baseline
20. god_enhance - Single entry
21. god_enhance_batch - Multiple entries
22. god_clear_gnn_cache - Clean up

### Phase 4: Compression
23. god_compression_stats - Current state
24. god_recompress_all - Dry run
25. god_query_expanded - Verify expansion
26. god_self_query - Test self-knowledge

### Phase 5: Configuration & Status
27. god_config_get - Current config
28. god_capabilities_status - All capabilities
29. god_containment_status - Containment rules
30. god_partner_status - Partner config

### Phase 6: Scheduler
31. god_scheduler_stats - Baseline
32. god_schedule - Create task
33. god_tasks - List tasks
34. god_pause - Pause task
35. god_resume - Resume task
36. god_trigger - Trigger task
37. god_cancel - Cancel task

### Phase 7: Deep Work
38. god_deepwork_status - Current state
39. god_deepwork_start - Start session
40. god_deepwork_checkpoint - Create checkpoint
41. god_deepwork_log - Get log
42. god_deepwork_pause - Pause session
43. god_deepwork_resume - Resume session

### Phase 8: Notifications
44. god_notify_history - Current history
45. god_notify_preferences - Current prefs
46. god_notify - Send test notification

### Phase 9: Failure Memory
47. god_failure_stats - Baseline
48. god_failure_record - Record test failure
49. god_failure_query - Query failures
50. god_failure_resolve - Resolve failure

### Phase 10: Curiosity
51. god_budget_status - Current budget
52. god_curiosity_list - List probes
53. god_budget_history - History

### Phase 11: Git Analysis
54. god_git_branches - List branches
55. god_git_history - Recent commits
56. god_git_diff - Current changes
57. god_git_blame - Sample file

### Phase 12: Code Analysis
58. god_analyze_lint - Lint codebase
59. god_analyze_types - Type check
60. god_analyze_deps - Dependency graph
61. god_analyze_impact - Impact analysis

### Phase 13: AST Operations
62. god_ast_parse - Parse file
63. god_ast_symbols - Get symbols
64. god_ast_query - Query nodes

### Phase 14: Code Review
65. god_review_config - Current config
66. god_quick_review - Quick review
67. god_security_review - Security scan

### Phase 15: Wolfram (if configured)
68. god_wolfram_calculate - Simple calculation
69. god_wolfram_convert - Unit conversion

### Phase 16: Playwright (optional)
70. god_pw_launch - Launch browser
71. god_pw_navigate - Navigate
72. god_pw_screenshot - Screenshot
73. god_pw_console - Get logs
74. god_pw_close - Close browser

### Phase 17: LSP (optional)
75. god_lsp_start - Start server
76. god_lsp_symbols - Search symbols
77. god_lsp_diagnostics - Get errors
78. god_lsp_stop - Stop server

### Phase 18: Cleanup
79. god_delete - Delete test entry
80. god_stats - Final stats

---

## Success Criteria

- [ ] All 80 core tests pass
- [ ] No unexpected errors
- [ ] Memory stats healthy after tests
- [ ] No orphaned test data
- [ ] All capabilities return expected formats

---

## Notes

- Some tools require external configuration (Slack, Discord, Wolfram API)
- Playwright tests require headless browser support
- LSP tests require TypeScript language server
- Codex tests spawn sub-agents (resource intensive)
- Debug/Profile tests require running Node process
