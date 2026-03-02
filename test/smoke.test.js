const request = require('supertest');
const app = require('../server'); // Corrected path

describe('Server Smoke Test', () => {
  it('should return 200 for the index page', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.text).toContain('CVK&#233;sz&#237;t&#337;');
    expect(res.text).toContain('hu'); // Hungarian lang
  });
});
