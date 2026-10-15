-- Additive: pergunta curta do bairro quando não dá para extraí-lo do endereço.
ALTER TYPE "CustomerBookingConversationState" ADD VALUE IF NOT EXISTS 'NEIGHBORHOOD';
