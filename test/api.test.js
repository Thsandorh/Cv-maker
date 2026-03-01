const request = require('supertest');
const app = require('../server');

// Mock Google Generative AI
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockResolvedValue({
        response: {
          text: () => '<html><body>Hungarian CV content</body></html>'
        }
      })
    })
  }))
}));

describe('API Test', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test_key';
  });

  it('should return a generated CV', async () => {
    const userData = {
        fullName: 'Test User',
        email: 'test@example.com',
        mode: 'bulk',
        bulkData: 'I have some experience'
    };

    const res = await request(app)
      .post('/api/generate-cv')
      .field('userData', JSON.stringify(userData))
      .field('theme', 'modern');

    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('cvId');
    expect(res.body).toHaveProperty('previewHtml');
    expect(res.body.previewHtml).toContain('Hungarian CV content');
  });

  it('should calculate ATS score and return actionable tips', async () => {
    const userData = {
      fullName: 'Test User',
      email: 'test@example.com',
      mode: 'bulk',
      bulkData: 'JavaScript developer with React and Node.js experience'
    };

    const generated = await request(app)
      .post('/api/generate-cv')
      .field('userData', JSON.stringify(userData))
      .field('theme', 'modern');

    const cvId = generated.body.cvId;
    const res = await request(app)
      .post(`/api/cv/${cvId}/analyze-ats`)
      .send({
        jobDescription: 'React Node.js JavaScript communication problem solving'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('overallScore');
    expect(res.body).toHaveProperty('breakdown');
    expect(Array.isArray(res.body.tips)).toBe(true);
  });

  it('should create a targeted version and list versions', async () => {
    const userData = {
      fullName: 'Test User',
      email: 'test@example.com',
      mode: 'bulk',
      bulkData: 'I worked as a backend engineer on APIs and databases'
    };

    const generated = await request(app)
      .post('/api/generate-cv')
      .field('userData', JSON.stringify(userData))
      .field('theme', 'modern');

    const baseCvId = generated.body.cvId;
    const created = await request(app)
      .post(`/api/cv/${baseCvId}/create-version`)
      .send({
        jobTitle: 'Senior Backend Engineer',
        jobDescription: 'Node.js, PostgreSQL, API design'
      });

    expect(created.statusCode).toBe(200);
    expect(created.body).toHaveProperty('cvId');
    expect(created.body.cvId).not.toBe(baseCvId);

    const versions = await request(app).get(`/api/cv/${baseCvId}/versions`);
    expect(versions.statusCode).toBe(200);
    expect(Array.isArray(versions.body.versions)).toBe(true);
    expect(versions.body.versions.length).toBeGreaterThanOrEqual(2);
  });

  it('should reject tracked download link creation without admin auth', async () => {
    const userData = {
      fullName: 'Test User',
      email: 'test@example.com',
      mode: 'bulk',
      bulkData: 'Sample profile data for tracked link test'
    };

    const generated = await request(app)
      .post('/api/generate-cv')
      .field('userData', JSON.stringify(userData))
      .field('theme', 'modern');

    const cvId = generated.body.cvId;
    const res = await request(app)
      .post(`/api/cv/${cvId}/tracked-download-link`)
      .send({});

    expect(res.statusCode).toBe(401);
  });

  it('should deny admin profile endpoint without authentication', async () => {
    const res = await request(app).get('/api/admin/me');
    expect(res.statusCode).toBe(401);
  });
});
