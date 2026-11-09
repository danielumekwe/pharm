BEGIN;

DROP TABLE "platform_rate_limit_blocks";
DROP TABLE "platform_rate_limit_ip_rules";
DROP TABLE "platform_rate_limit_events";
DROP TABLE "platform_rate_limit_policies";
DROP TABLE "platform_rate_limit_config";

COMMIT;
