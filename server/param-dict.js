/**
 * 参数取值字典（联动下拉的内置数据源）
 *
 * 说明：真实服务能提供的字典（凭证类型 / 凭证编号 / 印章 / 凭证报文）一律走
 * SOAP 实时取数（见 link-options.js）；本文件只提供「服务端未提供字典」时
 * 的规范值，用于保证每个参数点「…」都有可选值。
 *
 * 取值依据：
 *  - 机构类型：EVoucherDLL.dll 逆向出的 orgType 常量（102/103/201/011）
 *  - 区划：国家标准行政区划代码
 *  - 其余为协议字段的枚举语义（年度、张数、页号、数据类型、退回状态等）
 */

/** 区划：省级 + 重庆市辖区县（默认测试区划 500000） */
const ADM_DIVS = [
  { value: "500000", label: "500000 - 重庆市" },
  { value: "500101", label: "500101 - 重庆市万州区" },
  { value: "500102", label: "500102 - 重庆市涪陵区" },
  { value: "500103", label: "500103 - 重庆市渝中区" },
  { value: "500104", label: "500104 - 重庆市大渡口区" },
  { value: "500105", label: "500105 - 重庆市江北区" },
  { value: "500106", label: "500106 - 重庆市沙坪坝区" },
  { value: "500107", label: "500107 - 重庆市九龙坡区" },
  { value: "500108", label: "500108 - 重庆市南岸区" },
  { value: "500109", label: "500109 - 重庆市北碚区" },
  { value: "500112", label: "500112 - 重庆市渝北区" },
  { value: "500113", label: "500113 - 重庆市巴南区" },
  { value: "500115", label: "500115 - 重庆市长寿区" },
  { value: "500116", label: "500116 - 重庆市江津区" },
  { value: "500117", label: "500117 - 重庆市合川区" },
  { value: "500118", label: "500118 - 重庆市永川区" },
  { value: "500120", label: "500120 - 重庆市璧山区" },
  { value: "500151", label: "500151 - 重庆市铜梁区" },
  { value: "500152", label: "500152 - 重庆市潼南区" },
  { value: "500153", label: "500153 - 重庆市荣昌区" },
  { value: "500154", label: "500154 - 重庆市开州区" },
  { value: "500155", label: "500155 - 重庆市梁平区" },
  { value: "500156", label: "500156 - 重庆市武隆区" },
  { value: "110000", label: "110000 - 北京市" },
  { value: "120000", label: "120000 - 天津市" },
  { value: "130000", label: "130000 - 河北省" },
  { value: "140000", label: "140000 - 山西省" },
  { value: "150000", label: "150000 - 内蒙古自治区" },
  { value: "210000", label: "210000 - 辽宁省" },
  { value: "220000", label: "220000 - 吉林省" },
  { value: "230000", label: "230000 - 黑龙江省" },
  { value: "310000", label: "310000 - 上海市" },
  { value: "320000", label: "320000 - 江苏省" },
  { value: "330000", label: "330000 - 浙江省" },
  { value: "340000", label: "340000 - 安徽省" },
  { value: "350000", label: "350000 - 福建省" },
  { value: "360000", label: "360000 - 江西省" },
  { value: "370000", label: "370000 - 山东省" },
  { value: "410000", label: "410000 - 河南省" },
  { value: "420000", label: "420000 - 湖北省" },
  { value: "430000", label: "430000 - 湖南省" },
  { value: "440000", label: "440000 - 广东省" },
  { value: "450000", label: "450000 - 广西壮族自治区" },
  { value: "460000", label: "460000 - 海南省" },
  { value: "510000", label: "510000 - 四川省" },
  { value: "520000", label: "520000 - 贵州省" },
  { value: "530000", label: "530000 - 云南省" },
  { value: "540000", label: "540000 - 西藏自治区" },
  { value: "610000", label: "610000 - 陕西省" },
  { value: "620000", label: "620000 - 甘肃省" },
  { value: "630000", label: "630000 - 青海省" },
  { value: "640000", label: "640000 - 宁夏回族自治区" },
  { value: "650000", label: "650000 - 新疆维吾尔自治区" },
];

/** 证书（证书ID）——测试环境常用测试证书；服务端 getSnInfo 可返回正式证书列表 */
const CERTS = [
  { value: "TC10163135", label: "TC10163135 - 测试证书（默认）" },
  { value: "TC10163136", label: "TC10163136 - 测试证书2" },
];

/** 机构类型（逆向 EVoucherDLL 常量） */
const ORG_TYPES = [
  { value: "102", label: "102 - 财政部门" },
  { value: "103", label: "103 - 主管部门" },
  { value: "201", label: "201 - 代理银行" },
  { value: "011", label: "011 - 用票单位" },
];

/** 退回状态（batchQueryVoucherNosByBackStatus.backStatus） */
const BACK_STATUS = [
  { value: "0", label: "0 - 未退回" },
  { value: "1", label: "1 - 已退回" },
  { value: "2", label: "2 - 退回待处理" },
];

/** 数据类型（getData2.dataType） */
const DATA_TYPES = [
  { value: "1", label: "1 - 凭证数据" },
  { value: "2", label: "2 - 附件数据" },
  { value: "3", label: "3 - 签章数据" },
  { value: "4", label: "4 - 日志数据" },
];

/** 退回原因（returnVoucher.reason） */
const REASONS = [
  { value: "信息有误", label: "信息有误" },
  { value: "重复入账", label: "重复入账" },
  { value: "金额不符", label: "金额不符" },
  { value: "其他", label: "其他" },
];

/** 凭证状态 */
const STATUSES = [
  { value: "0", label: "0 - 未签章" },
  { value: "1", label: "1 - 已签章" },
  { value: "2", label: "2 - 已发送" },
  { value: "3", label: "3 - 已确认" },
];

/**
 * 凭证字段名（getVoucherFieldValue.fieldName）
 * 服务端要求「首字母大写」写法（如 Total / AgencyName），全大写会报
 * EVS230「凭证里未找到【...】字段」。字段取自凭证报文真实节点。
 */
const FIELDS = [
  { value: "VoucherNo", label: "VoucherNo - 凭证编号" },
  { value: "VtCode", label: "VtCode - 凭证类型代码" },
  { value: "VouDate", label: "VouDate - 凭证日期" },
  { value: "AdmDivCode", label: "AdmDivCode - 区划代码" },
  { value: "StYear", label: "StYear - 年度" },
  { value: "PayAmt", label: "PayAmt - 支付金额" },
  { value: "PayeeAcctName", label: "PayeeAcctName - 收款人名称" },
  { value: "PayeeAcctNo", label: "PayeeAcctNo - 收款人账号" },
  { value: "PayeeAcctBankName", label: "PayeeAcctBankName - 收款人开户行" },
  { value: "PayAcctName", label: "PayAcctName - 付款人名称" },
  { value: "PayAcctNo", label: "PayAcctNo - 付款人账号" },
  { value: "AgencyName", label: "AgencyName - 预算单位名称" },
  { value: "AgencyCode", label: "AgencyCode - 预算单位编码" },
  { value: "FundTypeName", label: "FundTypeName - 资金性质" },
  { value: "PayTypeName", label: "PayTypeName - 支付方式" },
  { value: "PaySummaryName", label: "PaySummaryName - 支付摘要" },
  { value: "CurrencyCode", label: "CurrencyCode - 币种" },
  { value: "Remark", label: "Remark - 备注" },
];

/** 印章编号（stampNos）——服务端 getSnInfo 可返回真实印章序列号 */
const STAMP_NOS = [
  { value: "STAMP0001", label: "STAMP0001 - 测试印章（默认）" },
  { value: "STAMP0002", label: "STAMP0002 - 测试印章2" },
];

module.exports = { ADM_DIVS, CERTS, ORG_TYPES, BACK_STATUS, DATA_TYPES, REASONS, STATUSES, FIELDS, STAMP_NOS };
