const fs = require('fs');
const path = require('path');

async function testReg() {
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  let body = '';
  body += '--' + boundary + '\r\n';
  body += 'Content-Disposition: form-data; name="name"\r\n\r\nTest User\r\n';
  body += '--' + boundary + '\r\n';
  body += 'Content-Disposition: form-data; name="phone"\r\n\r\n9999999123\r\n';
  body += '--' + boundary + '\r\n';
  body += 'Content-Disposition: form-data; name="email"\r\n\r\n\r\n'; // Empty email
  body += '--' + boundary + '\r\n';
  body += 'Content-Disposition: form-data; name="password"\r\n\r\npassword123\r\n';
  body += '--' + boundary + '\r\n';
  body += 'Content-Disposition: form-data; name="role"\r\n\r\nelectrician\r\n';
  body += '--' + boundary + '\r\n';
  body += 'Content-Disposition: form-data; name="profileImage"; filename="test.jpg"\r\n';
  body += 'Content-Type: image/jpeg\r\n\r\ndummy content\r\n';
  body += '--' + boundary + '--\r\n';

  try {
    const response = await fetch('http://localhost:5001/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
      body: body
    });
    const data = await response.json();
    console.log('Response:', response.status, data);
  } catch (error) {
    console.error('Error:', error);
  }
}
testReg();
