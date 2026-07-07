import type { ReactNode } from "react";
import { commercialIdentityReady, legalConfig, publicCommercialValue } from "../legalConfig";
import type { ViewKey } from "../types";

export type LegalDocumentKey = "terms" | "privacy" | "commercial" | "refund" | "contact" | "disclaimer";

const legalLinks: Array<{ key: LegalDocumentKey | "pricing"; label: string; description: string }> = [
  { key: "terms", label: "利用規約", description: "利用条件、禁止事項、サービス変更など" },
  { key: "privacy", label: "プライバシーポリシー", description: "ブラウザ保存、決済・契約情報の取り扱い" },
  { key: "commercial", label: "特定商取引法に基づく表記", description: "販売条件、支払時期、事業者情報" },
  { key: "refund", label: "解約・返金方針", description: "更新停止、利用終了時期、返金条件" },
  { key: "pricing", label: "料金", description: "無料版とPro版の機能・予定価格" },
  { key: "contact", label: "お問い合わせ", description: "連絡先と問い合わせ時の注意事項" },
  { key: "disclaimer", label: "免責事項", description: "試算結果と専門的助言に関する注意" }
];

function DocumentHeader({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: string }) {
  return (
    <section className="panel legal-intro">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{lead}</p>
      <p className="legal-updated">最終更新日: {legalConfig.lastUpdated}</p>
    </section>
  );
}

function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel legal-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function LegalNotice() {
  return (
    <section className="legal-status" role="status">
      <strong>現在、Pro版の申込みと課金は受け付けていません</strong>
      <p>Pro版は月額590円（税込）を予定しています。販売者情報と更新・解約条件を確定し、申込み開始前に改めて案内します。</p>
    </section>
  );
}

export function LegalIndexView({ setActiveView }: { setActiveView: (view: ViewKey) => void }) {
  return (
    <div className="legal-layout">
      <DocumentHeader
        eyebrow="法務・サポート"
        title="利用条件とお問い合わせ"
        lead="Life Compassの利用条件、データの取り扱い、料金、解約・返金方針を文書ごとに確認できます。"
      />
      <LegalNotice />
      <section className="legal-link-grid" aria-label="法務ページ一覧">
        {legalLinks.map((link) => (
          <button type="button" className="legal-link" key={link.key} onClick={() => setActiveView(link.key)}>
            <strong>{link.label}</strong>
            <span>{link.description}</span>
          </button>
        ))}
      </section>
    </div>
  );
}

function TermsDocument() {
  return (
    <>
      <DocumentHeader
        eyebrow="利用規約"
        title="Life Compass 利用規約"
        lead="本規約は、Life Compassを利用する際の条件を定めるものです。"
      />
      <LegalSection title="1. サービスの目的">
        <p>Life Compassは、家計、資産、目標、家族、ライフイベントなどを整理し、入力条件に基づく将来の見通しを確認するためのライフプラン管理ツールです。</p>
      </LegalSection>
      <LegalSection title="2. 利用条件">
        <ul>
          <li>利用者は、自身の判断と責任で入力内容を管理し、本サービスを利用します。</li>
          <li>ブラウザ内のデータとJSONバックアップは、利用者自身が保管・管理します。</li>
          <li>未成年者が利用する場合は、必要に応じて保護者の同意を得てください。</li>
        </ul>
      </LegalSection>
      <LegalSection title="3. 禁止事項">
        <ul>
          <li>法令または公序良俗に反する行為</li>
          <li>本サービスや第三者の権利・利益を侵害する行為</li>
          <li>不正アクセス、過度な負荷、解析・改変など運営を妨げる行為</li>
          <li>本サービスを利用した虚偽表示、詐欺、無断販売その他の不正行為</li>
        </ul>
      </LegalSection>
      <LegalSection title="4. 有料機能">
        <p>Pro版の提供開始後は、料金ページおよび申込み最終確認画面に表示された価格、更新周期、解約・返金条件が適用されます。現在は有料販売を行っていません。</p>
      </LegalSection>
      <LegalSection title="5. サービスの変更・停止">
        <p>保守、障害、法令対応、仕様改善その他必要な場合に、サービスの全部または一部を変更・停止することがあります。重要な変更は、可能な範囲で本サービス上に表示します。</p>
      </LegalSection>
      <LegalSection title="6. 知的財産権">
        <p>本サービスのプログラム、文章、画面デザインなどに関する権利は、運営者または正当な権利者に帰属します。利用者が入力したデータの権利は利用者に帰属します。</p>
      </LegalSection>
      <LegalSection title="7. 保証と責任の範囲">
        <p>本サービスは、特定の結果、正確性、完全性、継続提供、目的適合性を保証しません。運営者の故意または重過失、その他法令上責任を制限できない場合を除き、本サービスの利用により生じた損害について責任を負わないものとします。</p>
      </LegalSection>
      <LegalSection title="8. 規約の変更・準拠法">
        <p>必要に応じて本規約を変更することがあります。変更後の規約は本ページへの掲載時から適用します。本規約は日本法に準拠し、紛争が生じた場合は運営者所在地を管轄する日本の裁判所を第一審の専属的合意管轄裁判所とします。</p>
      </LegalSection>
    </>
  );
}

function PrivacyDocument() {
  return (
    <>
      <DocumentHeader
        eyebrow="プライバシーポリシー"
        title="データと個人情報の取り扱い"
        lead="ライフプランの入力データと、将来の契約・決済情報を分けて取り扱います。"
      />
      <LegalSection title="1. ライフプランデータ">
        <ul>
          <li>収入、支出、資産、家族、目標、イベント、メモ、試算条件は、原則として利用中のブラウザ内に保存されます。</li>
          <li>現在、これらのデータをLife Compassのサーバーへ送信して保存するクラウド同期は行いません。</li>
          <li>将来クラウドバックアップを提供する場合も、利用者が選んだときだけ使う任意機能として提供し、取り扱い内容を事前に明示します。</li>
          <li>JSONファイルの保管、共有、削除、別端末への移行は利用者自身で管理してください。</li>
        </ul>
      </LegalSection>
      <LegalSection title="2. 取得する可能性がある情報">
        <p>Pro版の提供開始後は、ログイン・契約管理のため、メールアドレス、利用者識別子、プラン区分、契約状態、更新日、Stripeの顧客・契約識別子、作成・更新日時を取得する場合があります。カード番号などの決済情報はStripeが取り扱い、Life Compassのサーバーには保存しません。</p>
      </LegalSection>
      <LegalSection title="3. 利用目的">
        <ul>
          <li>サービス提供、本人確認、契約状態の判定</li>
          <li>決済、更新、解約、返金および問い合わせ対応</li>
          <li>不正利用の防止、障害調査、セキュリティ確保</li>
          <li>法令上必要な記録の保存</li>
        </ul>
      </LegalSection>
      <LegalSection title="4. 外部サービス">
        <p>サイト配信・契約情報の管理にCloudflare、決済にStripeを利用する予定です。各社はサービス提供に必要な範囲で、アクセス情報、契約情報、決済情報を取り扱う場合があります。導入時には利用サービスと取り扱い内容を更新します。</p>
      </LegalSection>
      <LegalSection title="5. ブラウザ保存とアクセス情報">
        <p>設定やライフプランの保存にlocalStorageなどのブラウザ機能を使用します。また、配信事業者がセキュリティや障害対応のため、IPアドレス、ブラウザ情報、アクセス日時などを一時的に処理する場合があります。</p>
      </LegalSection>
      <LegalSection title="6. 保存期間・安全管理">
        <p>契約・問い合わせ情報は、利用目的、法令上の保存義務、紛争対応に必要な期間だけ保持します。不正アクセス、漏えい、改ざんなどを防ぐため、アクセス制御や秘密情報の分離など合理的な安全管理措置を講じます。</p>
      </LegalSection>
      <LegalSection title="7. 照会・削除の依頼">
        <p>サーバー側で保有する個人情報の確認、訂正、削除などを希望する場合は、本人確認に必要な情報を添えてお問い合わせください。ブラウザ内データは、データ管理画面またはブラウザ機能から利用者自身で削除できます。</p>
      </LegalSection>
    </>
  );
}

function CommercialDocument() {
  const rows = [
    ["販売事業者", publicCommercialValue(legalConfig.operatorName)],
    ["運営責任者", publicCommercialValue(legalConfig.representativeName)],
    ["所在地", publicCommercialValue(legalConfig.address)],
    ["電話番号", publicCommercialValue(legalConfig.phone)],
    ["お問い合わせ", legalConfig.contactEmail],
    ["販売URL", legalConfig.websiteUrl],
    ["販売価格", `${legalConfig.proPriceLabel}（現在は申込みできません）`],
    ["商品代金以外の必要料金", "インターネット接続・通信に必要な費用は利用者の負担となります。"],
    ["支払方法", "Stripeが取り扱うクレジットカード等（提供開始時に確定します）"],
    ["支払時期", "申込時に初回決済し、その後は毎月の契約更新日に自動決済します。"],
    ["サービス提供時期", "決済完了と契約状態の確認後、直ちにPro機能を利用できます。"],
    ["契約期間・更新", "1か月単位の自動更新です。解約手続きが完了するまで更新されます。"],
    ["解約方法", "アプリ内からStripeの契約管理画面を開き、次回更新日前までに解約します。"],
    ["解約後の利用", "解約手続き後も支払済み期間の終了まではPro機能を利用できます。"],
    ["返品・返金", "デジタルサービスの性質上、法令上必要な場合等を除き、支払済み料金の日割り返金は行いません。詳細は解約・返金方針をご確認ください。"],
    ["動作環境", "最新の主要ブラウザを推奨します。端末・ブラウザの設定により一部機能を利用できない場合があります。"]
  ];

  return (
    <>
      <DocumentHeader
        eyebrow="特定商取引法に基づく表記"
        title="販売条件に関する表示"
        lead="Pro版の販売開始に向けた予定条件です。現在は申込みと課金を受け付けていません。"
      />
      <LegalNotice />
      {!commercialIdentityReady && (
        <section className="legal-status" role="status">
          <strong>販売者情報の開示請求について</strong>
          <p>販売事業者名、運営責任者、所在地、電話番号は、申込みの判断前に確認できるよう、メールでの請求に対して遅滞なく開示します。</p>
        </section>
      )}
      <section className="panel legal-section">
        <div className="legal-definition-list">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function RefundDocument() {
  return (
    <>
      <DocumentHeader
        eyebrow="解約・返金方針"
        title="Pro版の解約と返金"
        lead="提供開始時に適用する予定の方針です。現在は有料契約がないため、解約・返金対象の購入はありません。"
      />
      <LegalNotice />
      <LegalSection title="解約方法と反映時期">
        <ul>
          <li>アプリ内からStripeの契約管理画面を開き、いつでも解約手続きができます。</li>
          <li>解約は現在の支払済み期間の終了時に反映され、次回以降の自動更新を停止します。</li>
          <li>解約手続き後も、支払済み期間の終了まではPro機能を利用できます。</li>
        </ul>
      </LegalSection>
      <LegalSection title="返金条件">
        <ul>
          <li>デジタルサービスの性質上、利用者都合による支払済み料金の日割り返金は原則として行いません。</li>
          <li>重複決済、運営者の処理誤り、法令上返金が必要な場合は、状況を確認して返金します。</li>
          <li>長時間の重大な障害など、運営者側の事情でサービスを提供できなかった場合は、影響範囲に応じて個別に対応します。</li>
        </ul>
      </LegalSection>
      <LegalSection title="返金の申請">
        <p>決済日、Stripeの領収書に記載された情報、登録メールアドレス、申請理由を添えて、決済から7日以内を目安にお問い合わせください。カード番号全体やセキュリティコードは送信しないでください。</p>
      </LegalSection>
      <LegalSection title="解約後のデータ">
        <p>ブラウザ内に保存されたライフプランデータは、解約によって自動削除されません。Pro機能で作成した内容は残りますが、契約期間終了後はPro機能からの閲覧・編集が制限される場合があります。事前にJSONバックアップを作成してください。</p>
      </LegalSection>
    </>
  );
}

function ContactDocument() {
  const subject = encodeURIComponent("【Life Compass】お問い合わせ");
  return (
    <>
      <DocumentHeader
        eyebrow="お問い合わせ"
        title="Life Compass サポート"
        lead="不具合、契約、解約、返金、データの扱いに関するお問い合わせを受け付けます。"
      />
      <section className="panel contact-panel">
        <div>
          <span>お問い合わせメール</span>
          <strong>{legalConfig.contactEmail}</strong>
          <p>通常3営業日以内を目安に返信します。内容によっては回答に時間がかかる場合があります。</p>
        </div>
        <a className="button-link" href={`mailto:${legalConfig.contactEmail}?subject=${subject}`}>メールを作成</a>
      </section>
      <LegalSection title="記載していただきたい内容">
        <ul>
          <li>お問い合わせの種類（操作、不具合、契約、解約、返金など）</li>
          <li>利用端末、OS、ブラウザ</li>
          <li>問題が発生した画面と操作内容</li>
          <li>Pro版開始後の契約問い合わせでは、登録メールアドレスと決済日</li>
        </ul>
      </LegalSection>
      <LegalSection title="販売者情報の開示請求">
        <p>特定商取引法に基づく販売事業者名、運営責任者、所在地、電話番号の開示を希望する場合は、件名を「【Life Compass】販売者情報の開示請求」としてご連絡ください。申込みの判断前に確認できるよう遅滞なく回答します。</p>
      </LegalSection>
      <LegalSection title="送信しないでください">
        <p>カード番号全体、セキュリティコード、パスワード、本人確認書類、資産・収入・家族情報を含むJSONバックアップはメールに添付しないでください。</p>
      </LegalSection>
    </>
  );
}

function DisclaimerDocument() {
  return (
    <>
      <DocumentHeader
        eyebrow="免責事項"
        title="試算結果と情報の利用について"
        lead="Life Compassは、教育・参考目的で現状と将来の前提を整理するライフプラン管理ツールです。"
      />
      <LegalSection title="試算結果">
        <ul>
          <li>表示結果は、利用者が入力した条件とアプリ内の計算方法に基づく参考試算です。</li>
          <li>将来の収益、資産額、目標達成、資産が維持できる期間を保証するものではありません。</li>
          <li>ばらつきを用いた試算も将来を予測・保証するものではなく、前提の違いを確認するための参考情報です。</li>
        </ul>
      </LegalSection>
      <LegalSection title="専門的助言ではありません">
        <p>本サービスは、投資助言、税務助言、法律助言、保険助言、医療・介護に関する専門的助言を提供しません。個別の金融商品、銘柄、保険商品、暗号資産などを推奨しません。実際の判断は、必要に応じて適切な専門家へ相談してください。</p>
      </LegalSection>
      <LegalSection title="制度・数値の変化">
        <p>税金、社会保険、年金、医療・介護制度、物価、金利、運用結果などは変更・変動します。アプリ内の参考値が最新制度や個別事情に一致するとは限りません。</p>
      </LegalSection>
      <LegalSection title="データとサービス提供">
        <p>ブラウザデータの消失、端末故障、ブラウザ初期化などに備え、定期的にJSONバックアップを作成してください。本サービスが中断・変更・終了しないことや、すべての端末で正常に動作することは保証しません。</p>
      </LegalSection>
    </>
  );
}

export function LegalDocumentView({ document }: { document: LegalDocumentKey }) {
  const documents: Record<LegalDocumentKey, ReactNode> = {
    terms: <TermsDocument />,
    privacy: <PrivacyDocument />,
    commercial: <CommercialDocument />,
    refund: <RefundDocument />,
    contact: <ContactDocument />,
    disclaimer: <DisclaimerDocument />
  };

  return <div className="legal-layout">{documents[document]}</div>;
}
