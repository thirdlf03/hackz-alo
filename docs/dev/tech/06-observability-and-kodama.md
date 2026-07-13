# tech: 可観測性と「こだま」

[`tech.md`](../../../tech.md)(技術方針の目次)からの分冊。仕様の正は [`youken.md`](../../../youken.md)。

## 11. Metrics / Logs / Alerts

### 11.1 Metrics model

metrics は「Sandbox 内の実体」と「シナリオ演出」を合わせる。

```ts
type MetricsSnapshot = {
  at: number;
  cpu: number;
  memory: number;
  disk: number;
  http5xxRate: number;
  latencyP95Ms: number;
  rps: number;
  dbConnections: number;
  queueDepth: number;
};
```

MVP は metrics exporter が JSON を吐く。

```json
{
  "at": 120000,
  "cpu": 34,
  "memory": 62,
  "disk": 97,
  "http5xxRate": 0.18,
  "latencyP95Ms": 1200
}
```

Session DO は 1-2 秒ごとに metrics を取得して client に SSE 配信する。Worker/Sandbox の subrequest limit があるため、過剰な `exec()` polling は避ける。Sandbox SDK の各 operation は Workers subrequest limit の影響を受ける [R5]。

### 11.2 Logs

ログは sandbox 内 file として存在させる。

```txt
/workspace/logs/access.log
/workspace/logs/app.log
/workspace/logs/batch.log
/workspace/logs/debug.log
```

terminal から `tail -f` できる。UI の log viewer は backend が file tail を proxy してもよいが、MVP は terminal 操作を中心にする。

### 11.3 Alerts

alert は scenario definition から発火する。実 metrics threshold から自動発火する拡張も可能。

Alert object:

```ts
type Alert = {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  firedAtMs: number;
  acknowledgedAtMs?: number;
  source: 'scenario' | 'monitor';
};
```

## 12. こだま

> 注記: 本章の構文・CLI(`unlang`)・拡張子(`.un`)は現行実装のもの。目標仕様(新構文)は youken.md「こだま(社内 DSL)」節で定義済みで、DSL トークン・CLI 名・拡張子の移行は未着手。

### 12.1 目的

こだまは、障害対応で「仕様を読んで原因を推測する」体験を作るための小さな DSL。MVP では batch script と config expression に限定する。

### 12.2 Syntax(現行実装)

```txt
うんちく <text>              comment
うん <name> = <expr>         variable declaration / assignment
うん？ <expr>                if truthy
うーん <expr>                calculate / evaluate
うん！ <expr?>               return

operators:
  うんたす    +
  うんひく    -
  うんかけ    *
  うんわり    /

literals:
  うんなし    0 / false
  うんあり    1 / true

runtime error:
  こだまが返ってきません
```

### 12.3 Parser / evaluator

MVP は手書き parser でよい。文法が小さく、学習教材として error 表示を制御したいから。

```txt
Program     := Statement*
Statement   := Comment | Assignment | Return | ExprStatement
Assignment  := "うん" Identifier "=" Expression
Return      := "うん！" Expression?
Expression  := Term (("うんたす" | "うんひく") Term)*
Term        := Factor (("うんかけ" | "うんわり") Factor)*
Factor      := Number | Boolean | Identifier | "(" Expression ")"
```

内部 error は構造化する。

```ts
type UnlangRuntimeError = {
  code: 'DIVISION_BY_ZERO' | 'UNDEFINED_VARIABLE' | 'SYNTAX_ERROR';
  line: number;
  column: number;
  internalMessage: string;
  playerMessage: 'こだまが返ってきません'; // 現行データは移行予定
};
```

player-facing log は `こだまが返ってきません` のみ。Runbook / 仕様表 / file 内容から 0 division を推測させる。

### 12.4 実行方法

Sandbox 内に `unlang` CLI を置く。

```txt
unlang run /workspace/services/batch/sales.un
unlang check /workspace/services/batch/sales.un
```

batch failure scenario では深夜 3 時相当の trigger で `unlang run` が失敗し、`/workspace/logs/batch.log` に曖昧な error を出す。
