import { constants, publicEncrypt } from "node:crypto";

/**
 * The web app RSA-encrypts the login password before sending it - a plaintext
 * password is rejected by the token endpoint with `AUTH_INVALID_PARAM`. It uses
 * JSEncrypt, whose default is PKCS#1 v1.5 padding, which `node:crypto` matches
 * with RSA_PKCS1_PADDING.
 *
 * These public keys were lifted from the site's own JS bundle. The bundle picks
 * one by build environment:
 *   dev            -> DEV
 *   test | local   -> TEST
 *   anything else  -> PROD   (this is what globalhome.solarmanpv.com serves)
 *
 * The production key is tried first; the others are fallbacks in case a given
 * deployment is served the test key, so login does not silently depend on
 * guessing the environment right.
 */

const PROD = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3l1Nrr0DcQttjHYjnKak
TgE7IdEj9exorl/NdCe0Wi+2hiKJ+fDbGN6CSXmz+oj+XeWtKptMQYx8GXwMDfTn
fc5oXD8uvZDRciwkWLuLRHArqsjepOgzpzML2hBrK0W1Jp/GjZI/kDJb9MPT7JPB
6ntQuFBom8Plvo+dJynXriYeNsSFWHjSRJLV10HI2aI8z/KIb6uCEz/iyZkez9T+
zDUtr4HGQLekVCb2Ub9PxVdBpT6OIDmIcdPUHzDB3SU+hQHNt1uOFtQMujnTTZ5m
+6GLMqB23cZiaPvtVu8tt8H6FjwWGxYd1MlmI1O+98r2+vE21zZEIDMxp9a5H7yV
YwIDAQAB
-----END PUBLIC KEY-----`;

const TEST = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvMRZ1E7+lzeOuLT6N34w
yW5v1ZSv6hKOdnECTY/xCphTxuJ3sDi4LuWFTSV7/S3WXUYpDVDDIZQIq1aN6iei
JkIbHo2TvQy/byDQxyrqq4G8G1+ieYlUv+0ITQezxyk0ot7C6tPxLd7pkuSbaM/5
JN+A2pKLs1G3nOq+XfLR+mIUOB+83OamGhxoFYuEhWSfFRCotVwuURv1UwnBNufG
Pxy87X4sTwjHDZUN0bYeOFENb5OIyIWJDLitGgiKzSMG7df/Hj/RqF+L0Jlkw5Xj
THe6NfPa/IaqWTxlpuvcs5C/go6c6ddRP4J9uZsqviMUugwn4cF53roOV0jihoQG
+wIDAQAB
-----END PUBLIC KEY-----`;

const DEV = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyGjMqrPRePghbW1Ynaot
pktLgXGQCYH53u2yp1yhyaJvCSAvXSkZziiErXbZsN327MGuWsn76DU2wYpox6Gr
WAMJNxDV+Vl4VSQsKlQ8BvTCVsZSdtXJuzgAp+bAoqcI4ohHzDiZzIsEtx/BggSX
NFzipnVOmKkVjiKfEXSpRik0+7NMSQHLEt3R4usFK3CNiq52iPVS7dAff5a8Mu8F
gT7eUPJPFBElm/nWcqthL2BRaajCqX0Ct7sXyViWjQg7kYSbQIwtz4C7hqiaGsZv
+iwwT2l7dwFSGSXUyuVAVU7QxUYIICFnPRerxt0F4NTg/JyDDtNOkmgHlyCfMcR/
lQIDAQAB
-----END PUBLIC KEY-----`;

export const SOLARMAN_PUBLIC_KEYS = { PROD, TEST, DEV } as const;

/** RSA-encrypts one value the way JSEncrypt does, returning base64. */
export function encryptPassword(plain: string, pem: string): string {
	return publicEncrypt(
		{ key: pem, padding: constants.RSA_PKCS1_PADDING },
		Buffer.from(plain, "utf8"),
	).toString("base64");
}
