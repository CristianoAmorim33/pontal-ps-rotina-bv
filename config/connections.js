import "dotenv/config";
import Client from 'ssh2-sftp-client';
import fs from 'fs';

export const ClientSftpBee = new Client();

await ClientSftpBee.connect({
  host: process.env.SFTP_HOST_BEE,
  port: Number(process.env.SFTP_PORT_BEE) || 22,
  username: process.env.SFTP_USER_BEE,
  password: process.env.SFTP_PASS_BEE,
});

export const ClientSftpBV = new Client();

await ClientSftpBV.connect({
  host: process.env.SFTP_HOST_BV,
  port: Number(process.env.SFTP_PORT_BV),
  username: process.env.SFTP_USER_BV,
  privateKey: fs.readFileSync(process.env.SFTP_PASS_BV),
});
