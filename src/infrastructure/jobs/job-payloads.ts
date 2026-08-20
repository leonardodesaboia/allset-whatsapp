export type MessageDispatchPayload = Record<string, never>;

export type ReceivedAudioPayload = {
  inboundMessageId: string;
};

export type OpportunityExpirationPayload = {
  opportunityId: string;
};

export type RecruitmentReengagementPayload = {
  conversationId: string;
  reengagementCount: number;
};

export type JobPayloadMap = {
  "message-dispatch": MessageDispatchPayload;
  "received-audio": ReceivedAudioPayload;
  "opportunity-expiration": OpportunityExpirationPayload;
  "recruitment-reengagement": RecruitmentReengagementPayload;
};
