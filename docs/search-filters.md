# 検索フィルター仕様

2026-09-22のカテゴリ別相談で確定。表示設定は `src/features/search/filter-config.ts`、型・取得候補はBackend `GET /v1/categories/:category/filters` に分離する。

## 表示順（各欄の左から）

|カテゴリ|基本|詳細|
|---|---|---|
|CPU|メーカー、ファミリー、ソケット|コア数、TDP、クーラー付属|
|CPUクーラー|メーカー、冷却方式、高さ、ラジエーターサイズ|ファンサイズ|
|メモリ|メーカー、メモリ規格、メモリ速度、合計容量、枚数|ECC、XMP、EXPO|
|マザーボード|メーカー、ソケット、チップセット、フォームファクター、メモリ規格|メモリスロット数、最大メモリ容量、M.2スロット数、背面コネクター|
|GPU|ボードメーカー、GPUメーカー、GPUシリーズ、VRAM容量|長さ、TDP、メモリ規格|
|ストレージ|メーカー、ストレージ種類、フォームファクター、インターフェース、容量|なし|
|電源|メーカー、フォームファクター、電源容量、効率認証|ケーブル方式、奥行き、12VHPWRコネクター数|
|ケース|メーカー、ケースタイプ、最大GPU長、最大CPUクーラー高|最大電源長、容積、背面コネクター対応|
|ケースファン|メーカー、サイズ、風向き、PWM|コネクター、セット個数|
|OS|キーワード検索のみ|なし|
|モニター|メーカー、画面サイズ、解像度プリセット、リフレッシュレート、パネル種類|横解像度、縦解像度、アスペクト比、応答速度、HDR、可変リフレッシュレート、映像入力端子|
|キーボード|メーカー、サイズ、スイッチ種類、接続方式|配列、ホットスワップ、ポーリングレート、機能|
|マウス|メーカー、接続方式、形状、重量|サイズ、持ち方、ポーリングレート、最大DPI|
|ヘッドホン|メーカー、装着タイプ、接続方式、マイク搭載|ヘッドホン種類、重量、機能、対応プラットフォーム|
|マイク|メーカー、接続方式、指向性|機能|
|Webカメラ|メーカー、解像度、フレームレート、接続方式|なし|

キャプチャーカード、ネットワークカード、サウンドカード、マウスパッド、スピーカー、サーマルペースト、アクセサリーはメーカーのみ。新規追加候補に出さない旧保存カテゴリも、置換時はメーカーのみを使用する。

## 個別仕様

- ストレージ種類は単一選択。指定なし / SSD（すべて） / NVMe SSD / HDD / SSHD。実際に存在する候補を使用し、NVMe SSDはSSDとNVMe=1が取得できる場合に追加する。`storage_type: ["SSD"]` と `nvme: [1]` へ変換。別の種類への変更時はNVMe条件を残さない。独立したNVMe・PCIe世代UIは表示しない。
- モニターの解像度は単一プリセット（フルHD 1920×1080、WUXGA 1920×1200、WQHD 2560×1440、UWQHD 3440×1440、4K UHD 3840×2160）と横/縦の最小・最大を連動。POSTの公開scalar fields `resolution_width` / `resolution_height` をrangesとして送信。プリセットで4境界を一括更新、範囲を変更するとカスタム表示。「指定なし」は4境界を解除。メタデータに観測範囲がないため値を推測しない。
- ケースタイプはAPI分類そのままの複数選択。対応マザーボードや「選択クラス以下」へ展開しない。収容寸法は搭載パーツ以上を下限に指定する。
- メモリの容量・枚数、ファンのセット個数は1商品の内容。構成シートの行数ではない。
- boolean相当は単一選択、未指定と数値0を区別する。表示翻訳で検索値を正規化・統合しない。

## 共通操作

- 最上部は全カテゴリ共通のキーワード欄。PCは左フィルター/右結果の独立スクロール。モバイルは絞り込みを初期折りたたみし、パネルと結果を同じ下部領域でスクロール。詳細条件も折りたたみ。
- 複数選択は検索欄付きチェックリスト。チェック後も開いたまま、Escapeで一覧を閉じて見出しへフォーカス。候補検索はローカル処理。候補一覧に高さ上限を設ける。
- 製品検索はキーワード・選択・数値・解除すべてを共通の300ms debounceで反映。Dynamic Facetは選択・数値・解除だけを独立した300ms debounceで反映し、キーワード編集で候補更新を遅延・再発行しない。適用ボタンなし。IME変換中は製品検索しない。空欄で片側境界を省略、不正な数値/逆転範囲ではエラー表示し検索しない。カタログの観測範囲へclampせず、REALのstepへ丸めない。
- 条件変更で旧リクエストを中断し1ページ目に戻る。keywordはoffset、空欄はcursor。全条件をQuery keyに含める。
- タグは選択肢ごと・範囲項目ごとに表示し個別解除。初期3件と「ほかN件」を表示。全解除は基本/詳細のフィルターだけを消し、キーワードを残す。
- カテゴリ別に入力をメモリ内保持し、追加/置換で共有。開き直しは1ページ目。リロードでリセット。localStorageや構成の保存schemaは変更しない。

## API境界・障害時

- `control` / `target` / `value_type` / `options` / `range` をZod検証。カテゴリ不一致、重複ID、型違い、逆転した範囲等を拒否。未知のカテゴリ別追加項目はUIへ自動露出しない。
- `GET /v1/categories/:category/filters` はdefinition / label / control / target / value_type / static range / 初期options。空配列とnull範囲を許容し、使えない数値controlを無効化。
- `POST /v1/categories/:category/facets` は現在のtyped条件に応じたmulti_select候補。`POST /v1/search` は製品結果。rangeのmin/max/stepは静的metadataのままで、Dynamic Range Aggregationは行わない。
- `SearchDraft → static definitions → compileConditions → canonical SearchConditions`を検索とDynamic Facetの両方で共有。Dynamic responseは純粋関数`mergeDynamicFacetOptions`で表示用定義にだけ反映し、compiler・タグは常に静的定義を使う。候補の縮小で条件を暗黙に解除・省略しない。
- Dynamic Facetのbodyとquery keyには`filters / ranges / facets`のみ。keyword、orderBy、pagination、include、identifierは含めない。例えばkeyword=`9800X3D`、manufacturer=`AMD`でも候補はAMDというtyped条件に追従し、9800X3D検索結果だけの候補ではない。
- Backendのself-exclusionをそのまま使用。同一fieldの候補計算ではそのfield自身の条件だけが除かれるため、Intel + LGA1700でも他のIntel socketを追加できる。Frontendに互換表や条件除外ロジックを持たない。countは正の整数として検証・保持するが画面には表示しない。
- 動的候補から消えた未選択値は一覧から除外。選択済み値はそのラベルと「現在利用できません」の表示を残し、欄内またはタグで解除可能。矛盾は製品検索を停止する入力エラーとは分ける。draft/sessionを自動変更しない。
- 条件別React Query keyで古いrequestを中断し、debounce中は古いresponseを表示に適用しない。更新中は「候補を更新しています…」と表示し新規選択を一時停止するが、既存選択の解除やrange編集は可能。
- Dynamic APIのnetwork/timeout/429/5xx/不正responseは小さな通知と再試行ボタンを表示し、静的候補へfallback。製品検索は継続する。Retry-After経過後に再試行可能。metadata失敗とは区別する。OSはFilter UI・metadata・Dynamic Facet requestなし。
- NVMe SSD (`__nvme_ssd`) はFrontend専用の複合候補として静的定義から保持する例外。生facetの集合だけでは複合条件のself-exclusionを表せないため、その可否を推測せず既存UXを優先し、追加requestは行わない。SSD→`storage_type=SSD`、NVMe SSD→`storage_type=SSD AND nvme=1`の変換は維持。resolution preset/custom width/heightも静的rangeとして維持。
- metadata取得失敗はフィルターパネルで再試行可能。選択条件なしならキーワード検索/一覧は利用可能。保存条件ありで定義がなければ、解除か取得成功まで製品検索を待つ。
- 各選択10値、合計40値、filters 8項目、ranges 8項目、facets 4項目、全体16項目を検証。上限に達したチェックリストでも既存の選択は解除可能。
- 条件なしはGET、条件ありはPOST。POSTには表示ラベル、step、空配列、空の条件groupを含めない。同項目内OR、項目間AND。facetsの結果展開は要求せず、既存製品schema・保存形式を維持。
- リトライ、Retry-After、15秒timeout、credentials omit、出典表示は共通clientに従う。

## 検証

`npm test` はmetadata schema、HTTP変換、数値0・片側range・REAL端点、NVMe変換、解像度連動、未知/消滅条件、複雑度上限、カテゴリ別状態を検証。
`npm run test:e2e` は固定APIでPC/モバイルの300ms統合待機・IME・入力エラー・型保持・cursor/offset・解除・状態復元・追加/置換・POST中断・候補検索・選択上限・Escape・320pxレイアウト・取得失敗/再試行・OSを検証。
`npm run test:live` は任意の本番APIスモーク。通常CIは本番に依存しない。
Dynamic Facetのschema（型・count・重複・512上限）、HTTP（body投影・abort・timeout・Retry-After）、表示merge、矛盾保持、特殊フィルターをunit testで検証。固定APIのPC/モバイルE2EでIntel/AMD候補更新、self-exclusion、矛盾解除、stale response、300ms debounce、keyword非連動、障害fallback/retryを検証する。live smokeはCPU静的metadataから実在manufacturerを選び、Dynamic POSTの200とschemaを確認する。
