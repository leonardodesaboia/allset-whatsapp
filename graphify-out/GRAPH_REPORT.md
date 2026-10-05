# Graph Report - .  (2026-09-01)

## Corpus Check
- 266 files · ~108,698 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 798 nodes · 2001 edges · 44 communities (36 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_API Routes|API Routes]]
- [[_COMMUNITY_Booking Workflows|Booking Workflows]]
- [[_COMMUNITY_Recruitment UI|Recruitment UI]]
- [[_COMMUNITY_Admin Booking UI|Admin Booking UI]]
- [[_COMMUNITY_Admin Actions|Admin Actions]]
- [[_COMMUNITY_Admin Navigation|Admin Navigation]]
- [[_COMMUNITY_Package Dependencies|Package Dependencies]]
- [[_COMMUNITY_Dead Code Configuration|Dead Code Configuration]]
- [[_COMMUNITY_File Storage|File Storage]]
- [[_COMMUNITY_Messaging Integration|Messaging Integration]]
- [[_COMMUNITY_Booking Integration Tests|Booking Integration Tests]]
- [[_COMMUNITY_TypeScript Configuration|TypeScript Configuration]]
- [[_COMMUNITY_Customer Booking Flow|Customer Booking Flow]]
- [[_COMMUNITY_Payment Processing|Payment Processing]]
- [[_COMMUNITY_Intent Conversation|Intent Conversation]]
- [[_COMMUNITY_Recruitment Conversation|Recruitment Conversation]]
- [[_COMMUNITY_Opportunity Matching|Opportunity Matching]]
- [[_COMMUNITY_Outbox Processing|Outbox Processing]]
- [[_COMMUNITY_Customer Question Outbox|Customer Question Outbox]]
- [[_COMMUNITY_Audio Transcription|Audio Transcription]]
- [[_COMMUNITY_Admin Seeding|Admin Seeding]]
- [[_COMMUNITY_Stale Booking Cron|Stale Booking Cron]]
- [[_COMMUNITY_Formatting Configuration|Formatting Configuration]]
- [[_COMMUNITY_Error Reporting|Error Reporting]]
- [[_COMMUNITY_Recruitment Reengagement|Recruitment Reengagement]]
- [[_COMMUNITY_Auth Rate Limiting|Auth Rate Limiting]]
- [[_COMMUNITY_E2E Test Setup|E2E Test Setup]]
- [[_COMMUNITY_Production Build|Production Build]]
- [[_COMMUNITY_Root Layout|Root Layout]]
- [[_COMMUNITY_Login Page|Login Page]]
- [[_COMMUNITY_Container Entrypoint|Container Entrypoint]]
- [[_COMMUNITY_Next Configuration|Next Configuration]]
- [[_COMMUNITY_Playwright Configuration|Playwright Configuration]]
- [[_COMMUNITY_PostCSS Configuration|PostCSS Configuration]]
- [[_COMMUNITY_Customer Modal E2E|Customer Modal E2E]]

## God Nodes (most connected - your core abstractions)
1. `recordAuditLog()` - 26 edges
2. `err()` - 26 edges
3. `Env` - 26 edges
4. `ok()` - 25 edges
5. `enqueueOutboundMessage()` - 24 edges
6. `textPayload()` - 22 edges
7. `logger` - 21 edges
8. `DomainError` - 19 edges
9. `compilerOptions` - 19 edges
10. `currentActor()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `enqueueText()` --calls--> `enqueueOutboundMessage()`  [EXTRACTED]
  src/application/marketplace/process-opportunity-response.usecase.ts → src/application/messaging/enqueue-outbound-message.usecase.ts
- `transitionStatus()` --calls--> `transitionLeadStatusInTransaction()`  [EXTRACTED]
  src/application/recruitment/conversation-engine.usecase.ts → src/application/recruitment/transition-lead-status.usecase.ts
- `publishJobSafe()` --calls--> `getSharedConnection()`  [INFERRED]
  src/infrastructure/jobs/publish-job.ts → src/infrastructure/jobs/bullmq-connection.ts
- `publishJobSafe()` --calls--> `getJobQueue()`  [INFERRED]
  src/infrastructure/jobs/publish-job.ts → src/infrastructure/jobs/job-queue.ts
- `addQuickNoteAction()` --calls--> `addLeadNote()`  [EXTRACTED]
  src/app/admin/recruitment/actions.ts → src/application/recruitment/lead-notes.usecase.ts

## Import Cycles
- None detected.

## Communities (44 total, 8 thin omitted)

### Community 0 - "API Routes"
Cohesion: 0.05
Nodes (61): { GET, POST }, GET(), GET(), GET(), GET(), POST(), POST(), POST() (+53 more)

### Community 1 - "Booking Workflows"
Cohesion: 0.08
Nodes (46): recordAuditLog(), RecordAuditLogInput, TransitionBookingStatusInput, transitionBookingStatusInTransaction(), Database, enqueueText(), OpportunityResponseOutcome, downloadReceivedAudio() (+38 more)

### Community 2 - "Recruitment UI"
Cohesion: 0.07
Nodes (64): actionError(), addAssessmentAction(), addQuickNoteAction(), addReferenceAction(), completeInterviewAction(), completeInterviewSchema, completeOnboardingContentAction(), confirmTermsAcceptanceAction() (+56 more)

### Community 3 - "Admin Booking UI"
Cohesion: 0.07
Nodes (34): formatDateTime(), OpportunityPage(), currentActor(), discardOutboxMessageAction(), messageIdSchema, retryableStatuses, retryAllDeadLettersAction(), retryOutboxMessageAction() (+26 more)

### Community 4 - "Admin Actions"
Cohesion: 0.08
Nodes (33): BookingActionResult, bookingIdSchema, confirmManualPaymentAction(), conversationIdSchema, createBookingAction(), createBookingSchema, currentActor(), dispatchOpportunityAction() (+25 more)

### Community 5 - "Admin Navigation"
Cohesion: 0.08
Nodes (28): MobileNav(), MobileNavProps, ICONS, NavLinkClient(), Column(), KanbanBoard(), KanbanColumnData, LeadCard() (+20 more)

### Community 6 - "Package Dependencies"
Cohesion: 0.04
Nodes (44): dependencies, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, better-auth, @better-auth/prisma-adapter, bullmq, class-variance-authority, clsx (+36 more)

### Community 7 - "Dead Code Configuration"
Cohesion: 0.07
Nodes (28): entry, ignore, ignoreDependencies, project, $schema, devDependencies, autoprefixer, dependency-cruiser (+20 more)

### Community 8 - "File Storage"
Cohesion: 0.15
Nodes (10): DeleteFileInput, GetFileInput, PutFileInput, SignedUrlInput, StorageProvider, StoredFile, InMemoryStorageProvider, LocalStorageProvider (+2 more)

### Community 9 - "Messaging Integration"
Cohesion: 0.15
Nodes (7): MessagingGateway, MessagingGatewayRegistry, SendMessageInput, SendMessageResult, EvolutionMessagingAdapter, StaticMessagingGatewayRegistry, MockMessagingAdapter

### Community 10 - "Booking Integration Tests"
Cohesion: 0.13
Nodes (5): transitionBookingStatusUseCase(), makeConversation(), phone(), getAuth(), startTestDatabase()

### Community 11 - "TypeScript Configuration"
Cohesion: 0.09
Nodes (22): compilerOptions, allowJs, esModuleInterop, exactOptionalPropertyTypes, incremental, isolatedModules, jsx, lib (+14 more)

### Community 12 - "Customer Booking Flow"
Cohesion: 0.18
Nodes (15): activePricingTiers(), enqueueQuestion(), pricingTierText(), quoteText(), resendCurrentQuestion(), scheduleDateText(), CustomerScheduleDateChoice, customerScheduleDateChoices() (+7 more)

### Community 13 - "Payment Processing"
Cohesion: 0.20
Nodes (7): ChargeRequest, ChargeResult, ChargeStatus, PaymentProvider, Money, MockPaymentProvider, StoredCharge

### Community 14 - "Intent Conversation"
Cohesion: 0.22
Nodes (12): processContactIntentSelection(), startContactIntentConversation(), processCustomerBookingAnswer(), startCustomerBookingConversation(), ackMessage(), ACTIVE_FUNNEL_STATUSES, processContactConversationText(), processRecruitmentAnswer() (+4 more)

### Community 15 - "Recruitment Conversation"
Cohesion: 0.28
Nodes (10): enqueueQuestion(), transitionStatus(), enqueueRecruitmentQuestion(), activeStates, ConversationState, globalCommand(), normalizeAnswer(), parseAnswer() (+2 more)

### Community 16 - "Opportunity Matching"
Cohesion: 0.18
Nodes (14): DAY_MAP, daysInWeeklyRange(), ELIGIBLE_STATUSES, fortalezaDate(), fortalezaParts, isEligibleForOpportunity(), LeadInfo, normalizeText() (+6 more)

### Community 17 - "Outbox Processing"
Cohesion: 0.18
Nodes (11): Database, EnqueueOutboundMessageInput, inputSchema, ProcessInboundEventInput, AudioMessagePayload, audioPayload(), InboundAudioMessagePayload, InboundMessagePayload (+3 more)

### Community 18 - "Customer Question Outbox"
Cohesion: 0.26
Nodes (8): customerQuestionText(), enqueueCustomerQuestion(), CUSTOMER_QUESTIONS, CustomerChoice, CustomerConversationState, CustomerQuestion, parseCustomerChoice(), CUSTOMER_SCHEDULE_TIME_CHOICES

### Community 19 - "Audio Transcription"
Cohesion: 0.33
Nodes (5): AudioTranscriber, AudioTranscriptionInput, AudioTranscriptionResult, OpenAiWhisperTranscriber, supportedTypes

### Community 20 - "Admin Seeding"
Cohesion: 0.33
Nodes (7): AdminSeedConfig, bootstrapAdmin(), hashPassword(), main(), prisma, readAdminSeedConfig(), testPassword

### Community 21 - "Stale Booking Cron"
Cohesion: 0.43
Nodes (7): GET(), enqueueIntentPrompt(), enqueueManualReviewNotice(), buildReminderText(), expireStaleBookings(), enqueueOutboundMessage(), textPayload()

### Community 22 - "Formatting Configuration"
Cohesion: 0.33
Nodes (5): printWidth, semi, singleQuote, tabWidth, trailingComma

### Community 24 - "Recruitment Reengagement"
Cohesion: 0.50
Nodes (3): activeStates, isEligibleForReengagement(), ReengagementCandidate

### Community 25 - "Auth Rate Limiting"
Cohesion: 0.50
Nodes (3): AuthRateLimitConfig, isAuthRateLimitEnabled(), LOOPBACK_HOSTS

### Community 26 - "E2E Test Setup"
Cohesion: 0.60
Nodes (4): assertSafeSeedTarget(), execFileAsync, globalSetup(), LOCAL_HOSTS

### Community 27 - "Production Build"
Cohesion: 0.50
Nodes (3): buildOnlyEnvironment, extraArguments, result

## Knowledge Gaps
- **199 isolated node(s):** `semi`, `trailingComma`, `singleQuote`, `printWidth`, `tabWidth` (+194 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@prisma/client` connect `Package Dependencies` to `API Routes`?**
  _High betweenness centrality (0.146) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Dead Code Configuration` to `Package Dependencies`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **What connects `semi`, `trailingComma`, `singleQuote` to the rest of the system?**
  _199 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `API Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.05287739783152627 - nodes in this community are weakly interconnected._
- **Should `Booking Workflows` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Recruitment UI` be split into smaller, more focused modules?**
  _Cohesion score 0.06774774774774775 - nodes in this community are weakly interconnected._
- **Should `Admin Booking UI` be split into smaller, more focused modules?**
  _Cohesion score 0.07344632768361582 - nodes in this community are weakly interconnected._