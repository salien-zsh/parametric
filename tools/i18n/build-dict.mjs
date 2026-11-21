/**
 * 中文词典生成器。
 *
 * 输入：tools/i18n/en-US.generated.json（codemod 抽出的全部 key）
 * 输出：src/i18n/zh-CN.json + tools/i18n/review.json（需人工复核的长句）
 *
 * 策略：
 *   1. EXACT —— 高频菜单/按钮/对话框的精确人工翻译，优先级最高；
 *   2. 句式模板 —— 把常见英文句式先转成中文语序；
 *   3. 术语表 —— CAD 专业词汇按「长词优先」替换，保证术语统一；
 *   4. AI 内部指令（只出现在 src/assistant 且很长的描述）保留英文，
 *      它们不显示在界面上，中文描述反而会改变模型的工具调用行为；
 *   5. 生成后逐条校验：必须含中文字符，否则列入 review 清单并回退英文。
 *
 * 这个脚本可重复运行：改 EXACT / TERMS 后重跑即可增量修订字典。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'src');
const EN = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/i18n/en-US.generated.json'), 'utf8'));

/**
 * 人工精翻表：优先于所有规则，逐条校对，可持续增量补充。
 * 自动加载 tools/i18n/manual*.json 的全部文件，按文件名排序合并，
 * 便于按批次追加（上游合并后重跑 codemod 也不会丢既有精翻）。
 */
const MANUAL_DIR = path.join(ROOT, 'tools/i18n');
const MANUAL = {};
for (const f of fs.readdirSync(MANUAL_DIR).filter((n) => /^manual.*\.json$/.test(n)).sort()) {
  Object.assign(MANUAL, JSON.parse(fs.readFileSync(path.join(MANUAL_DIR, f), 'utf8')));
}

/** 精确翻译：界面上最显眼、最需要统一的词条。 */
const EXACT = {
  'OK': '确定', 'Cancel': '取消', 'Cancel (Esc)': '取消 (Esc)', 'Yes': '是', 'No': '否',
  'Save': '保存', 'Save As': '另存为', 'Save As...': '另存为…', 'Open': '打开', 'Open...': '打开…',
  'New': '新建', 'New part': '新建零件', 'New Part': '新建零件', 'Close': '关闭', 'Delete': '删除',
  'Rename': '重命名', 'Edit': '编辑', 'Undo': '撤销', 'Redo': '重做', 'Apply': '应用', 'Reset': '重置',
  'Hide': '隐藏', 'Show': '显示', 'Copy': '复制', 'Paste': '粘贴', 'Cut': '剪切', 'Print': '打印',
  'Export': '导出', 'Import': '导入', 'Download': '下载', 'Upload': '上传', 'Search': '搜索',
  'Add': '添加', 'Remove': '移除', 'Clear': '清除', 'Refresh': '刷新', 'Back': '返回', 'Next': '下一步',
  'Done': '完成', 'Finish': '完成', 'Continue': '继续', 'Skip': '跳过', 'Retry': '重试', 'Try again': '重试',
  'Error': '错误', 'Warning': '警告', 'Info': '提示', 'Loading': '正在加载', 'Please wait': '请稍候',
  'Name': '名称', 'Value': '数值', 'Type': '类型', 'Size': '尺寸', 'Colour': '颜色', 'Color': '颜色',
  'Material': '材料', 'Appearance': '外观', 'Units': '单位', 'Decimals': '小数位数',
  'Parts': '零件', 'Recent': '最近', 'Examples': '示例', 'Help': '帮助', 'About': '关于',
  'Settings': '设置', 'Options': '选项', 'Preferences': '首选项', 'Language': '语言',
  'Features': '特征', 'Sketch': '草图', 'Sketches': '草图', 'View': '视图', 'Views': '视图',
  'Drawings': '工程图', 'Drawing': '工程图', 'Sheet': '图纸', 'Properties': '属性',
  'Design tree': '设计树', 'PropertyManager': '属性管理器', 'Task Pane': '任务窗格',
  'Front Plane': '前视基准面', 'Top Plane': '上视基准面', 'Right Plane': '右视基准面',
  'Front': '前视', 'Top': '上视', 'Right': '右视', 'Left': '左视', 'Back': '后视', 'Bottom': '下视',
  'Isometric': '等轴测', 'Normal To': '垂直于', 'Zoom to Fit': '缩放至适合', 'Fit': '适合',
  'Standard Views': '标准视图', 'Display Style': '显示样式', 'Section View': '剖视图',
  'Shaded With Edges': '带边着色', 'Shaded': '着色', 'Hidden Lines Removed': '消除隐藏线',
  'Hidden Lines Visible': '显示隐藏线', 'Wireframe': '线框', 'Perspective': '透视',
  'Extruded Boss': '拉伸凸台', 'Extruded Cut': '拉伸切除', 'Revolved Boss': '旋转凸台',
  'Revolved Cut': '旋转切除', 'Swept Boss': '扫掠凸台', 'Swept Cut': '扫掠切除',
  'Lofted Boss': '放样凸台', 'Lofted Cut': '放样切除', 'Fillet': '圆角', 'Chamfer': '倒角',
  'Shell': '抽壳', 'Draft': '拔模', 'Hole': '孔', 'Holes': '孔', 'Hole Wizard': '孔向导',
  'Linear Pattern': '线性阵列', 'Circular Pattern': '圆周阵列', 'Mirror': '镜像',
  'Reference Plane': '基准面', 'Reference Planes': '基准面', 'Plane': '基准面',
  'Line': '直线', 'Centerline': '中心线', 'Corner Rectangle': '边角矩形', 'Center Rectangle': '中心矩形',
  'Circle': '圆', 'Perimeter Circle': '三点圆', 'Centerpoint Arc': '圆心圆弧', 'Tangent Arc': '相切圆弧',
  '3 Point Arc': '三点圆弧', 'Polygon': '多边形', 'Straight Slot': '直槽', 'Slot': '槽',
  'Spline': '样条曲线', 'Point': '点', 'Points': '点', 'Smart Dimension': '智能尺寸',
  'Sketch Fillet': '草图圆角', 'Trim Entities': '修剪实体', 'Extend Entities': '延伸实体',
  'Offset Entities': '等距实体', 'Mirror Entities': '镜像实体', 'Convert Entities': '转换实体引用',
  'Construction Geometry': '构造几何', 'Add Constraint': '添加约束', 'Add Constraints': '添加约束',
  'Add Relation': '添加几何关系', 'Relations': '几何关系', 'Constraints': '约束',
  'Coincident': '重合', 'Horizontal': '水平', 'Vertical': '竖直', 'Parallel': '平行',
  'Perpendicular': '垂直', 'Tangent': '相切', 'Equal': '相等', 'Concentric': '同心',
  'Midpoint': '中点', 'Collinear': '共线', 'Symmetric': '对称', 'Fix': '固定',
  'Driven dimension': '从动尺寸', 'Make Driving': '设为驱动', 'Make Driven (reference)': '设为从动（参考）',
  'Depth': '深度', 'Angle': '角度', 'Radius': '半径', 'Diameter': '直径', 'Thickness': '厚度',
  'Distance': '距离', 'Spacing': '间距', 'Instances': '实例数', 'Draft angle': '拔模角度',
  'Counterbore diameter': '沉孔直径', 'Counterbore depth': '沉孔深度',
  'Countersink diameter': '锥形沉孔直径', 'Countersink angle': '锥形沉孔角度',
  'Direction 2': '方向 2', 'Depth (Direction 2)': '深度（方向 2）',
  'Spacing (Direction 2)': '间距（方向 2）', 'Instances (Direction 2)': '实例数（方向 2）',
  'Blind': '给定深度', 'Through All': '完全贯穿', 'Mid Plane': '两侧对称', 'Up To Next': '到下一面',
  'Mass Properties': '质量属性', 'Measure': '测量', 'Section': '剖视', 'Global Variables': '全局变量',
  'Equations': '方程式', 'Variables': '变量', 'Suppress': '压缩', 'Unsuppress': '解除压缩',
  'Rollback': '回滚', 'Hide/Show': '隐藏/显示', 'Edit Feature': '编辑特征', 'Edit Sketch': '编辑草图',
  'Shaded with edges': '带边着色', 'Open from Device...': '从设备打开…', 'Open from Device': '从设备打开',
  'Make Drawing': '生成工程图', 'Back to Model': '返回模型', 'Arrange standard views': '排布标准视图',
  'Add view': '添加视图', 'Change the view': '更改视图', 'Sheet Size': '图纸幅面', 'Scale': '比例',
  'Title Block': '标题栏', 'Export PDF': '导出 PDF', 'Export SVG': '导出 SVG',
  'Source Code on GitHub': '在 GitHub 查看源码', 'Keyboard Shortcuts': '键盘快捷键',
  'Repeat Last Command': '重复上一命令', 'About Parametric': '关于 Parametric',
  'Sends your messages and a description of the part to Puter AI. Check designs before relying on them.': '你的消息和零件描述会发送到 AI 服务。正式使用前请核对生成的设计。',
  'Sign in to Puter to save this part to your cloud and share it with others.': '登录后才能把零件保存到云端并分享给他人。',
  'Sharing needs Puter, which could not be loaded. Check your connection and reload.': '分享功能需要云服务，当前未能加载。请检查网络后重新载入。',
  'This part is saved in this browser. Save a copy to your Puter cloud, then share it.': '该零件保存在本机。先另存一份到云端，再进行分享。',
  'Changing units only changes how values are shown. The geometry keeps its size.': '更改单位只影响数值的显示方式，几何体的实际尺寸不变。',
  'Could not copy to the clipboard. Try again, or select and copy the report text manually.': '无法复制到剪贴板。请重试，或手动选中并复制报告文本。',
  'Leave the sketch and undo the changes made since you started editing it?': '退出草图并撤销本次编辑以来的全部修改？',
  'Select geometry; the constraints that fit appear in the PropertyManager. Or pick a constraint in the Constrain group of the Sketch tab and click the geometry it applies to.': '选择几何元素后，适用的约束会出现在属性管理器中；也可以在「草图」选项卡的「约束」组中选择约束，再单击要施加的几何元素。',
  'Changing units only changes how values are shown. The geometry keeps its size. ': '更改单位只影响数值的显示方式，几何体的实际尺寸不变。',
};

/** CAD 术语与界面词：长词优先，避免 "Extruded Boss" 被拆成两个词。 */
const TERMS = [
  ['Extruded Boss', '拉伸凸台'], ['Extruded Cut', '拉伸切除'], ['Revolved Boss', '旋转凸台'],
  ['Revolved Cut', '旋转切除'], ['Lofted Boss', '放样凸台'], ['Lofted Cut', '放样切除'],
  ['Swept Boss', '扫掠凸台'], ['Swept Cut', '扫掠切除'], ['Linear Pattern', '线性阵列'],
  ['Circular Pattern', '圆周阵列'], ['Reference Plane', '基准面'], ['Smart Dimension', '智能尺寸'],
  ['Sketch Fillet', '草图圆角'], ['Trim Entities', '修剪实体'], ['Extend Entities', '延伸实体'],
  ['Offset Entities', '等距实体'], ['Mirror Entities', '镜像实体'], ['Convert Entities', '转换实体引用'],
  ['Construction Geometry', '构造几何'], ['Hidden Lines Removed', '消除隐藏线'],
  ['Hidden Lines Visible', '显示隐藏线'], ['Shaded With Edges', '带边着色'],
  ['Mass Properties', '质量属性'], ['Global Variables', '全局变量'], ['Standard Views', '标准视图'],
  ['Design tree', '设计树'], ['PropertyManager', '属性管理器'], ['Front Plane', '前视基准面'],
  ['Top Plane', '上视基准面'], ['Right Plane', '右视基准面'], ['Center Rectangle', '中心矩形'],
  ['Corner Rectangle', '边角矩形'], ['Perimeter Circle', '三点圆'], ['Centerpoint Arc', '圆心圆弧'],
  ['Tangent Arc', '相切圆弧'], ['3 Point Arc', '三点圆弧'], ['Straight Slot', '直槽'],
  ['Add Constraint', '添加约束'], ['Add Relation', '添加几何关系'], ['Hole Wizard', '孔向导'],
  ['Make Drawing', '生成工程图'], ['Back to Model', '返回模型'], ['Zoom to Fit', '缩放至适合'],
  ['Section View', '剖视图'], ['Display Style', '显示样式'], ['Title Block', '标题栏'],
  ['Save As', '另存为'], ['Open from Device', '从设备打开'], ['New part', '新建零件'],
  ['Mid Plane', '两侧对称'], ['Through All', '完全贯穿'], ['Up To Next', '到下一面'],
  ['Direction 2', '方向 2'], ['Draft angle', '拔模角度'], ['Counterbore diameter', '沉孔直径'],
  ['Counterbore depth', '沉孔深度'], ['Countersink diameter', '锥形沉孔直径'],
  ['Countersink angle', '锥形沉孔角度'], ['Driven dimension', '从动尺寸'],
  ['Degrees of freedom', '自由度'], ['Reference dimension', '参考尺寸'],
  ['Sketch', '草图'], ['Sketches', '草图'], ['Feature', '特征'], ['Features', '特征'],
  ['Extrude', '拉伸'], ['Extrusion', '拉伸'], ['Revolve', '旋转'], ['Revolution', '旋转'],
  ['Fillet', '圆角'], ['Chamfer', '倒角'], ['Shell', '抽壳'], ['Draft', '拔模'],
  ['Hole', '孔'], ['Holes', '孔'], ['Pattern', '阵列'], ['Patterns', '阵列'],
  ['Mirror', '镜像'], ['Loft', '放样'], ['Sweep', '扫掠'], ['Plane', '基准面'],
  ['Planes', '基准面'], ['Dimension', '尺寸'], ['Dimensions', '尺寸'],
  ['Constraint', '约束'], ['Constraints', '约束'], ['Relation', '几何关系'], ['Relations', '几何关系'],
  ['View', '视图'], ['Views', '视图'], ['Drawing', '工程图'], ['Sheet', '图纸'],
  ['Material', '材料'], ['Materials', '材料'], ['Appearance', '外观'], ['Mass', '质量'],
  ['Volume', '体积'], ['Area', '面积'], ['Density', '密度'], ['Inertia', '惯性'],
  ['Section', '剖视'], ['Measure', '测量'], ['Variable', '变量'], ['Variables', '变量'],
  ['Equation', '方程式'], ['Equations', '方程式'], ['Expression', '表达式'],
  ['Select', '选择'], ['Selected', '已选'], ['Selection', '所选'], ['Deselect', '取消选择'],
  ['Click', '单击'], ['Clicking', '单击'], ['Double-click', '双击'], ['Pick', '拾取'],
  ['Drag', '拖动'], ['Drop', '拖放'], ['Hover', '悬停'], ['Scroll', '滚动'],
  ['Add', '添加'], ['Remove', '移除'], ['Delete', '删除'], ['Edit', '编辑'], ['Modify', '修改'],
  ['Change', '更改'], ['Set', '设置'], ['Create', '创建'], ['Open', '打开'], ['Close', '关闭'],
  ['Save', '保存'], ['Export', '导出'], ['Import', '导入'], ['Download', '下载'],
  ['Rename', '重命名'], ['Suppress', '压缩'], ['Unsuppress', '解除压缩'], ['Rollback', '回滚'],
  ['Rebuild', '重建'], ['Regenerate', '重新生成'], ['Undo', '撤销'], ['Redo', '重做'],
  ['Apply', '应用'], ['Reset', '重置'], ['Cancel', '取消'], ['OK', '确定'],
  ['Hide', '隐藏'], ['Show', '显示'], ['Toggle', '切换'], ['Rotate', '旋转'], ['Pan', '平移'],
  ['Zoom', '缩放'], ['Fit', '适合'], ['Orientation', '方向'], ['Normal', '法向'],
  ['Body', '实体'], ['Bodies', '实体'], ['Solid', '实体'], ['Face', '面'], ['Faces', '面'],
  ['Edge', '边'], ['Edges', '边'], ['Vertex', '顶点'], ['Vertices', '顶点'],
  ['Profile', '轮廓'], ['Profiles', '轮廓'], ['Curve', '曲线'], ['Curves', '曲线'],
  ['Line', '直线'], ['Lines', '直线'], ['Circle', '圆'], ['Circles', '圆'],
  ['Arc', '圆弧'], ['Arcs', '圆弧'], ['Point', '点'], ['Points', '点'],
  ['Axis', '轴'], ['Axes', '轴'], ['Origin', '原点'], ['Geometry', '几何'],
  ['Length', '长度'], ['Width', '宽度'], ['Height', '高度'], ['Depth', '深度'],
  ['Radius', '半径'], ['Diameter', '直径'], ['Angle', '角度'], ['Thickness', '厚度'],
  ['Distance', '距离'], ['Spacing', '间距'], ['Count', '数量'], ['Instances', '实例数'],
  ['Direction', '方向'], ['Offset', '等距'], ['Scale', '比例'], ['Tolerance', '公差'],
  ['Unit system', '单位制'], ['Units', '单位'], ['Decimals', '小数位数'],
  ['Name', '名称'], ['Value', '数值'], ['Type', '类型'], ['Size', '尺寸'],
  ['Colour', '颜色'], ['Color', '颜色'], ['Theme', '主题'], ['Light', '浅色'], ['Dark', '深色'],
  ['System', '跟随系统'], ['Part', '零件'], ['Parts', '零件'], ['Document', '文档'],
  ['File', '文件'], ['Files', '文件'], ['Folder', '文件夹'], ['Browser', '浏览器'],
  ['Cloud', '云端'], ['Device', '设备'], ['Recent', '最近'], ['Examples', '示例'],
  ['Help', '帮助'], ['About', '关于'], ['Settings', '设置'], ['Options', '选项'],
  ['Sheet Size', '图纸幅面'], ['Title', '标题'], ['Notes', '备注'], ['Status', '状态'],
  ['Search', '搜索'], ['Filter', '筛选'], ['Sort', '排序'], ['Refresh', '刷新'],
  ['Enable', '启用'], ['Disable', '禁用'], ['Reverse', '反向'], ['Flip', '翻转'],
  ['Preview', '预览'], ['Visible', '可见'], ['Hidden', '隐藏'], ['Transparent', '透明'],
  ['Automatic', '自动'], ['Manual', '手动'], ['Default', '默认'], ['Custom', '自定义'],
  ['General', '常规'], ['Advanced', '高级'], ['Position', '位置'], ['Positions', '位置'],
  ['Parameters', '参数'], ['Parameter', '参数'], ['Result', '结果'], ['Results', '结果'],
  ['Error', '错误'], ['Warning', '警告'], ['Invalid', '无效'], ['Failed', '失败'],
  ['Stainless Steel', '不锈钢'], ['Alloy Steel', '合金钢'], ['Cast Iron', '铸铁'],
  ['Aluminum', '铝合金'], ['Titanium', '钛合金'], ['Acrylic', '亚克力'], ['Nylon', '尼龙'],
  ['Brass', '黄铜'], ['Copper', '铜'], ['ABS', 'ABS'], ['PVC', 'PVC'],
  // 界面通用词（小写/复数形式也由不敏感匹配覆盖）
  ['Tools', '工具'], ['Tool', '工具'], ['Group', '组'], ['Tab', '选项卡'],
  ['Panel', '面板'], ['Dialog', '对话框'], ['Menu', '菜单'], ['Button', '按钮'],
  ['Tree', '树'], ['List', '列表'], ['Item', '项目'], ['Items', '项目'],
  ['Field', '字段'], ['Row', '行'], ['Column', '列'], ['Table', '表格'],
  ['Page', '页面'], ['Window', '窗口'], ['Account', '账户'], ['User', '用户'],
  ['Users', '用户'], ['Person', '成员'], ['Share', '共享'], ['Shared', '已共享'],
  ['Access', '访问权限'], ['Permission', '权限'], ['Owner', '所有者'],
  ['Connection', '连接'], ['Network', '网络'], ['Storage', '存储'],
  ['Local', '本地'], ['Recovery', '恢复'], ['Snapshot', '快照'],
  ['History', '历史'], ['Node', '节点'], ['Key', '键'], ['Keys', '键'],
  ['Names', '名称'], ['Numbers', '数值'], ['Values', '数值'], ['Sides', '边数'],
  ['Corner', '角点'], ['Corners', '角点'], ['Endpoints', '端点'], ['Endpoint', '端点'],
  ['Centre', '圆心'], ['Center', '圆心'], ['Sizes', '尺寸'], ['Degrees', '度'],
  ['Degree', '度'], ['Rectangle', '矩形'], ['Slot', '槽'], ['Polygon', '多边形'],
  ['Spline', '样条曲线'], ['Arcs', '圆弧'], ['Circles', '圆'], ['Slots', '槽'],
  ['Closed', '封闭'], ['Open', '开放'], ['Rounded', '圆角'], ['Existing', '现有'],
  ['Selected', '所选'], ['Available', '可用'], ['Distinct', '不同的'],
  ['Intersection', '交点'], ['Intersections', '交点'], ['Surface', '曲面'],
  ['Message', '消息'], ['Messages', '消息'], ['Report', '报告'],
  ['Shortcut', '快捷键'], ['Shortcuts', '快捷键'], ['Command', '命令'],
  ['Commands', '命令'], ['Step', '步骤'], ['Steps', '步骤'], ['Changes', '修改'],
  ['Edits', '编辑'], ['Side', '侧'], ['Cut', '切除'], ['Boss', '凸台'],
  ['Grid', '网格'], ['Line', '直线'], ['Two', '两'], ['Three', '三'],
  ['One', '一'], ['Four', '四'], ['Next', '下一'], ['Previous', '上一'],
  ['Start', '起点'], ['End', '终点'], ['Start point', '起点'], ['End point', '终点'],
  ['Centre point', '圆心'], ['Center point', '圆心'], ['Wheel', '滚轮'],
  ['Arrow keys', '方向键'], ['Keyboard', '键盘'], ['Mouse', '鼠标'],
  ['Touch', '触摸'], ['Trackpad', '触控板'], ['Screen', '屏幕'],
  ['Colour', '颜色'], ['Visible', '可见'], ['Wireframe', '线框'],
  ['Perspective', '透视'], ['Isometric', '等轴测'], ['Standard', '标准'],
  ['Orientation', '视图方向'], ['Title block', '标题栏'], ['Sheet size', '图纸幅面'],
  ['3D printing', '三维打印'], ['STL mesh', 'STL 网格'], ['STEP file', 'STEP 文件'],
  ['Metric', '公制'], ['Imperial', '英制'], ['Millimetre', '毫米'], ['Millimeter', '毫米'],
  ['Kilogram', '千克'], ['Gram', '克'], ['Metre', '米'], ['Meter', '米'],
  ['Inch', '英寸'], ['Pound', '磅'], ['Second', '秒'], ['Cubic metre', '立方米'],
  ['Per', '每'], ['Cubic', '立方'],
];

/** 残留功能词：规则替换后兜底，避免出现半中半英。 */
const GLUE = [
  [' the ', ''], [' a ', ''], [' an ', ''], [' of ', ''], [' to ', ''], [' for ', ''],
  [' with ', '，带'], [' in ', '中'], [' on ', '上'], [' at ', '在'], [' from ', '自'],
  [' and ', '和'], [' or ', '或'], [' by ', '按'], [' into ', '到'], [' about ', '关于'],
  [' its ', '其'], [' this ', '此'], [' that ', '该'], [' these ', '这些'], [' those ', '那些'],
  [' it ', '它'], [' you ', '你'], [' your ', '你的'], [' is ', '是'], [' are ', '是'],
  [' can ', '可'], [' will ', '将'], [' must ', '必须'], [' should ', '应'],
  [' not ', '不'], [' only ', '仅'], [' also ', '也'], [' then ', '然后'],
  [' each ', '每个'], [' all ', '全部'], [' same ', '相同'], [' between ', '之间'],
  [' before ', '之前'], [' after ', '之后'], [' when ', '当'], [' where ', '位置'],
  [' which ', '其'], [' what ', '所'], [' how ', '如何'], [' exactly ', '精确'],
  [' available ', '可用'], [' selected ', '所选'], [' existing ', '现有'],
];

/** 常见句式：先重排语序，再做术语替换。 */
const PATTERNS = [
  [/^Click (.+) to (.+)\.$/, (a, b) => `单击${a}以${b}。`],
  [/^Click (.+)\.$/, (a) => `单击${a}。`],
  [/^Pick (.+) to (.+)\.$/, (a, b) => `拾取${a}以${b}。`],
  [/^Pick (.+)\.$/, (a) => `拾取${a}。`],
  [/^Select (.+) to (.+)\.$/, (a, b) => `选择${a}以${b}。`],
  [/^Select (.+)\.$/, (a) => `选择${a}。`],
  [/^Add (.+) to (.+)\.$/, (a, b) => `向${b}添加${a}。`],
  [/^Add (.+)\.$/, (a) => `添加${a}。`],
  [/^Remove (.+)\.$/, (a) => `移除${a}。`],
  [/^Delete (.+)\.$/, (a) => `删除${a}。`],
  [/^Edit (.+)\.$/, (a) => `编辑${a}。`],
  [/^Set (.+)\.$/, (a) => `设置${a}。`],
  [/^Change (.+)\.$/, (a) => `更改${a}。`],
  [/^Use (.+) to (.+)\.$/, (a, b) => `使用${a}可${b}。`],
  [/^Use (.+)\.$/, (a) => `使用${a}。`],
  [/^Toggle (.+)\.$/, (a) => `切换${a}。`],
  [/^Show (.+)\.$/, (a) => `显示${a}。`],
  [/^Hide (.+)\.$/, (a) => `隐藏${a}。`],
  [/^Open (.+)\.$/, (a) => `打开${a}。`],
  [/^Save (.+)\.$/, (a) => `保存${a}。`],
  [/^Create (.+)\.$/, (a) => `创建${a}。`],
  [/^Give (.+) the same (.+)\.$/, (a, b) => `使${a}具有相同的${b}。`],
  [/^Make (.+)\.$/, (a) => `使${a}。`],
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CJK = /[\u4e00-\u9fff]/;

function applyTerms(s) {
  for (const [en, zh] of TERMS) {
    // 大小写不敏感：源码里小写句式（"sketch a rectangle..."）同样要命中；
    // \b 保证 add_ / set_dimensions 这类工具标识符不被拆开。
    s = s.replace(new RegExp(`\\b${esc(en)}\\b`, 'gi'), zh);
  }
  // 残留小写功能词（术语替换后剩下的句子骨架）
  let low = s;
  for (const [en, zh] of GLUE) low = low.split(en).join(zh);
  s = low;
  // 清理：中文之间的多余空格、英文标点
  s = s.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2')
    .replace(/([\u4e00-\u9fff])\s+([，。；：、])/g, '$1$2')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.\s*$/, '。')
    .trim();
  return s;
}

function translate(en) {
  if (MANUAL[en]) return MANUAL[en];
  if (EXACT[en]) return EXACT[en];
  for (const [re, make] of PATTERNS) {
    const m = en.match(re);
    if (m) return applyTerms(make(...m.slice(1)));
  }
  return applyTerms(en);
}

/** 记录每条文案的出处，用于识别「只在 AI 内部使用」的长指令。 */
function keySources() {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.ts')) continue;
      const text = fs.readFileSync(p, 'utf8');
      for (const m of text.matchAll(/\btr\((["'])((?:\\.|(?!\1)[^\\])*)\1/g)) {
        let key;
        try { key = JSON.parse(`"${m[2].replace(/\\'/g, "'")}"`); } catch { continue; }
        (out[key] ??= new Set()).add(path.relative(ROOT, p).replace(/\\/g, '/'));
      }
    }
  };
  walk(SRC);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

const sources = keySources();
const zh = {};
const review = [];
let skippedAI = 0;

for (const en of Object.keys(EN).sort()) {
  const files = sources[en] || [];
  // 只有「AI 工具定义/参数描述」文件里的文案才保留英文：它们发给模型，
  // 中文描述会改变既有的工具调用表现。助手面板/附件面板里的按钮、状态、
  // 提示是真实 UI，必须中文化，不能被 assistant 目录一刀切跳过。
  const AI_DEF_FILE = /\/assistant\/(?:tools|sketch|inspect|agent|features|prompt|refs)\.ts$/;
  const aiOnly = files.length > 0 && files.every((f) => AI_DEF_FILE.test(f));
  if (aiOnly) { skippedAI++; continue; }
  const value = translate(en);
  // 人工精翻表逐条校对过，直接采纳（其间的 GitHub / STEP 等专有名词是刻意保留的）。
  if (MANUAL[en]) { zh[en] = value; continue; }
  // 允许保留的专有名词/单位/快捷键/工具标识符，其余英文词一律视为未译干净。
  const ALLOW = /^(?:STL|STEP|ST P|PDF|SVG|PNG|DXF|CSV|JSON|WASM|OCCT|CAD|B-rep|Puter|Parametric|SolidWorks|Windows|macOS|WebGL|Ctrl|Alt|Shift|Esc|Enter|Tab|Space|Del|Delete|Home|End|mm|cm|um|kg|mg|lb|ft|deg|MB|GB|KB|ABS|PVC|PMMA|Ti|Al|IP|URL|AI|D|L|R|C|A|T|Q|F|X|Y|Z|id|ids|true|false|null|add_|set_|get_|sketch|face|edge|body|count|reverse|mid_plane|through_all|direction2|two_distances|construction)$/i;
  const leftovers = (value.match(/[A-Za-z]{2,}/g) || []).filter((w) => !ALLOW.test(w));
  // 质量闸门：宁可回退英文原句，也绝不让半中半英出现在界面上。
  const bad = !CJK.test(value) || leftovers.length > 0;
  if (bad) { review.push({ en, draft: value, leftovers: [...new Set(leftovers)], files }); continue; }
  zh[en] = value;
}

fs.writeFileSync(path.join(SRC, 'i18n/zh-CN.json'), JSON.stringify(zh, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(ROOT, 'tools/i18n/review.json'), JSON.stringify({
  totalKeys: Object.keys(EN).length, translated: Object.keys(zh).length,
  skippedAI, reviewCount: review.length, review,
}, null, 2) + '\n', 'utf8');

console.log(`字典生成：${Object.keys(zh).length}/${Object.keys(EN).length} 条中文，AI 内部指令保留英文 ${skippedAI} 条，建议复核 ${review.length} 条`);
