import { execSync } from 'child_process';

const urls = [
  'https://abc.vx9qn7zr.org/',
  'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vx9qn7zr.org/?t=a52',
  'https://bad_token.vx9qn7zr.org/?t=a52',
  'https://vx9qn7zr.org/',
];

for (const url of urls) {
  try {
    const result = execSync(
      `curl.exe -s -o NUL -w "HTTP_CODE: %{http_code}\\nSIZE_DOWNLOAD: %{size_download}\\nCONTENT_TYPE: %{content_type}" --max-time 15 "${url}"`,
      { encoding: 'utf-8', timeout: 20000 }
    );
    console.log(`\n=== ${url} ===`);
    console.log(result);
  } catch (e) {
    console.log(`\n=== ${url} ===`);
    console.log(`ERROR: ${e.message}`);
  }
}