# service-recovery

1. `curl -s localhost:8080/health` で実際の状態を確認する。
2. `yamactl status api` / `yamactl status fake-db` でプロセスとポートの状態を見る。
3. プロセスが死んでいれば `yamactl restart <service>` で再起動する。
4. 設定が壊れていれば `/workspace/releases/*.previous.json` から復元する。
5. ディスクが逼迫していれば不要なログを削除してから `yamactl restart api`。
6. 監視エージェントが応答しなければ `yamactl restart monitor-agent`。
