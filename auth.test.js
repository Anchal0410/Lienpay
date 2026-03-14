// ─────────────────────────────────────────────────────────────
// AUTH SYSTEM TESTS
// Run: npm test
// These test the full OTP flow end-to-end
// ─────────────────────────────────────────────────────────────

const request = require('supertest');
const app     = require('../../server');

describe('System 2 — Authentication', () => {

  describe('POST /api/auth/send-otp', () => {

    it('should send OTP for valid Indian mobile number', async () => {
      const res = await request(app)
        .post('/api/auth/send-otp')
        .send({ mobile: '9876543210' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.expires_in).toBe(600);
    });

    it('should reject mobile starting with 1-5', async () => {
      const res = await request(app)
        .post('/api/auth/send-otp')
        .send({ mobile: '1234567890' });

      expect(res.statusCode).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('should reject mobile with less than 10 digits', async () => {
      const res = await request(app)
        .post('/api/auth/send-otp')
        .send({ mobile: '98765' });

      expect(res.statusCode).toBe(422);
    });

    it('should reject missing mobile field', async () => {
      const res = await request(app)
        .post('/api/auth/send-otp')
        .send({});

      expect(res.statusCode).toBe(422);
    });
  });

  describe('POST /api/auth/verify-otp', () => {

    it('should reject wrong OTP', async () => {
      // First send a real OTP
      await request(app)
        .post('/api/auth/send-otp')
        .send({ mobile: '9999999999' });

      // Then verify with wrong OTP
      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ mobile: '9999999999', otp: '000000' });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject OTP with wrong format', async () => {
      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ mobile: '9876543210', otp: 'ABCDEF' });

      expect(res.statusCode).toBe(422);
    });

    it('should reject 5-digit OTP', async () => {
      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ mobile: '9876543210', otp: '12345' });

      expect(res.statusCode).toBe(422);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.statusCode).toBe(401);
    });

    it('should return 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid_token_here');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /health', () => {
    it('health check should return ok', async () => {
      const res = await request(app).get('/health');
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });
});
