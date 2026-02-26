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
    expect(res.text).toContain('Hungarian CV content');
  });
});
