/* 一次性改写脚本：预生成的平铺细节贴图（3D）+ 云与中尺度地貌改成采样。跑完就删。 */
var fs = require('fs');
var F = 'D:/CLAUDE/arcbang-main/ui/planets.js';
var s = fs.readFileSync(F, 'utf8');
function esc(x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function rep(a, b) {
  var pat = a.split('\n').map(esc).join('\\r?\\n');
  var m = s.match(new RegExp(pat, 'g')), n = m ? m.length : 0;
  if (n !== 1) throw new Error('hits=' + n + ' :: ' + a.slice(0, 100));
  s = s.replace(new RegExp(pat), function () { return b; });
}

/* ---------- 1) CPU：生成一次、所有行星共用的平铺细节贴图 ---------- */
rep("  var mapCache = {}; var mapCacheKeys = [];",
[
"  /* ---------------------------------------------------------- 平铺细节贴图（3D，32³ RGBA8）",
"     四个通道 = 四张互不相关的随机格点场。GPU 的三线性插值把格点值插成平滑的值噪声，",
"     所以「采一次贴图」就等于「算一次噪声」，而多倍频只要在不同缩放上多采几次。",
"     为什么要它：多倍频噪声是靠展开循环内联出来的，snoise 在一个片元着色器里被内联上百次，",
"     D3D 那边的优化时间是超线性的 —— globe 原来要编 47 秒。采样没有这个问题。",
"     确定性：固定种子生成一次、所有行星共用；每颗行星的差异靠偏移/旋转（uDetOff）给。 */",
"  var DET_N = 32, detailTexCache = null;",
"  function makeDetailTex() {",
"    if (detailTexCache) return detailTexCache;",
"    var N = DET_N, d = new Uint8Array(N * N * N * 4), x, y, z, c, i = 0;",
"    for (z = 0; z < N; z++) for (y = 0; y < N; y++) for (x = 0; x < N; x++) {",
"      for (c = 0; c < 4; c++) {",
"        /* 固定种子的格点哈希：换一台机器、换一次运行，这张贴图逐字节相同 */",
"        var h = hash32((x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ (c * 2654435761));",
"        d[i++] = h & 255;",
"      }",
"    }",
"    detailTexCache = { data: d, N: N };",
"    return detailTexCache;",
"  }",
"  var mapCache = {}; var mapCacheKeys = [];"
].join('\n'));

/* ---------- 2) GLR：3D 贴图上传 + 建一次存起来 ---------- */
rep("  GLR.prototype.tex2D = function (data, w, h, opts) {",
[
"  /* 3D 贴图（平铺细节贴图用）：三线性 + 三个方向都 REPEAT，这样按位置采样在球面上处处连续。 */",
"  GLR.prototype.tex3D = function (data, n) {",
"    var gl = this.gl, t = gl.createTexture();",
"    gl.bindTexture(gl.TEXTURE_3D, t);",
"    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);",
"    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, n, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);",
"    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);",
"    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);",
"    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);",
"    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);",
"    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);",
"    gl.bindTexture(gl.TEXTURE_3D, null);",
"    return t;",
"  };",
"  GLR.prototype.detailTex = function () {",
"    if (!this.detTex) { var d = makeDetailTex(); this.detTex = this.tex3D(d.data, d.N); }",
"    return this.detTex;",
"  };",
"  GLR.prototype.tex2D = function (data, w, h, opts) {"
].join('\n'));

/* ---------- 3) GLSL：采样函数 ---------- */
rep("    'uniform vec3 uDepositC, uCrackC;',",
[
"    'uniform vec3 uDepositC, uCrackC;',",
"    /* 平铺细节贴图。td(p) 采一次 = 一次值噪声；tf3(p,f) 是三个倍频的和。",
"       uDetOff 是每颗行星的偏移（从种子来），所以同一张贴图能长出不同的星球。 */",
"    'uniform sampler3D uDetTex; uniform vec3 uDetOff;',",
"    'vec4 td4(vec3 p){ return texture(uDetTex, p) * 2.0 - 1.0; }',",
"    'float td(vec3 p){ return texture(uDetTex, p).r * 2.0 - 1.0; }',",
"    'float tf3(vec3 p){ vec4 a=td4(p), b=td4(p*2.07+0.31), c=td4(p*4.21+0.63); return a.r*0.5 + b.g*0.3 + c.b*0.2; }',"
].join('\n'));

/* ---------- 4) 云：旋涡扭曲 + 多倍频全部换成采样 ---------- */
var oldCloud = [
"    'float cloudAt(vec3 n){ if(uCloud<=0.0) return 0.0; float c=cos(uCloudRot), s=sin(uCloudRot); vec3 m=vec3(n.x*c-n.z*s, n.y, n.x*s+n.z*c);',",
"    '  float cyc = max(uSty1.x, 0.3);',",
"    '  vec3 q = curlW(m, 1.15*cyc, 0.13);',",
"    '  q = curlW(q, 3.0*cyc, 0.055);',",
"    '  float f=0.0, a=0.5, fr=2.6*cyc; for(int i=0;i<4;i++){ f+=a*snoise(q*fr+float(i)*1.7+vec3(uTime*0.004*fr,0.0,0.0)); fr*=2.2; a*=0.5; }',",
"    '  if(uCloudDetail>0.5){ float d=0.0, ad=0.26, fd=40.0; for(int j=0;j<5;j++){ d+=ad*snoise(q*fd+float(j)*3.1+vec3(uTime*0.01,0.0,0.0)); fd*=2.4; ad*=0.55; } f+=d; }',"
].join('\n');
var newCloud = [
"    'float cloudAt(vec3 n){ if(uCloud<=0.0) return 0.0; float c=cos(uCloudRot), s=sin(uCloudRot); vec3 m=vec3(n.x*c-n.z*s, n.y, n.x*s+n.z*c);',",
"    '  float cyc = max(uSty1.x, 0.3);',",
"    '  vec3 adv = vec3(uTime*0.0012, 0.0, 0.0);',",
"    '  vec3 q = m*0.5 + uDetOff + adv;',",
"    /* 气旋：从贴图里取一个三分量的扰动向量当旋涡场，一次采样顶掉原来三次噪声 */",
"    '  vec3 w1 = td4(q*0.62).xyz; q = q + cross(m, w1)*0.30*cyc;',",
"    '  vec3 w2 = td4(q*1.55+0.17).xyz; q = q + cross(m, w2)*0.11*cyc;',",
"    '  float f = tf3(q*1.35*cyc);',",
"    '  if(uCloudDetail>0.5) f += td4(q*9.0+0.41).a*0.22 + td4(q*21.0+0.77).r*0.12;',"
].join('\n');
rep(oldCloud, newCloud);
/* 云影那份廉价云同样改采样 */
rep("    '  float cyc = max(uSty1.x, 0.3); vec3 q = curlW(m, 1.15*cyc, 0.13);',\n" +
    "    '  float f=0.0, a=0.5, fr=2.6*cyc; for(int i=0;i<2;i++){ f+=a*snoise(q*fr+float(i)*1.7); fr*=2.2; a*=0.5; }',",
    "    '  float cyc = max(uSty1.x, 0.3); vec3 q = m*0.5 + uDetOff;',\n" +
    "    '  q = q + cross(m, td4(q*0.62).xyz)*0.30*cyc;',\n" +
    "    '  float f = td4(q*1.35*cyc).r*0.62 + td4(q*2.8*cyc+0.31).g*0.32;',");

/* ---------- 5) 中尺度地貌：噪声换采样（这一层只进法线，不进高度场，没有 CPU 对齐约束） ---------- */
rep("    '    float r1=1.0-abs(snoise(n*58.0+4.0));',", "    '    float r1=1.0-abs(td(n*9.2+uDetOff));',");
rep("    '    float p1=1.0-abs(snoise(n*520.0+11.0));',", "    '    float p1=1.0-abs(td4(n*82.0+uDetOff).g);',");
rep("    '    float w=snoise(n*42.0+3.0);',", "    '    float w=td(n*6.7+uDetOff);',");
rep("    '    b += snoise(n*1900.0+9.0)*0.16;',", "    '    b += td4(n*302.0+uDetOff).b*0.16;',");
rep("    '    float pl=snoise(n*430.0+5.0);',", "    '    float pl=td4(n*68.0+uDetOff).a;',");
rep("    '    b += smoothstep(0.80,1.0, 1.0-abs(snoise(n*380.0+6.0)))*0.60;',", "    '    b += smoothstep(0.80,1.0, 1.0-abs(td4(n*60.0+uDetOff).r))*0.60;',");

fs.writeFileSync(F, s);
console.log('ok');
