export const JOB_NAME = {
  MESSAGE_DISPATCH: "message-dispatch",
  RECEIVED_AUDIO: "received-audio",
  OPPORTUNITY_EXPIRATION: "opportunity-expiration",
  RECRUITMENT_REENGAGEMENT: "recruitment-reengagement",
} as const;

export type JobName = (typeof JOB_NAME)[keyof typeof JOB_NAME];
