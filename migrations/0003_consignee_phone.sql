-- WhatsApp / contact phone for consignees
ALTER TABLE consignees ADD COLUMN phone TEXT NOT NULL DEFAULT '';
