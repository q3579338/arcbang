/* 一次性改写脚本：细节贴图的采样频率换算修正。跑完就删。
   换算关系：snoise(n*F) 的特征波长是 2π/F 弧度；贴图按 texture(uDetTex, n*k) 采样时，
   一个纹素是 1/(DET_N*k) 弧度。要让两者尺度相当，k = F/(2π*DET_N) = F/201。
   我第一版按 F/6.3 换算（少除了一个 DET_N），采样频率高了 32 倍 —— 纹素落到亚像素，
   整颗星球糊上一层白噪点。 */
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

/* 云：整段按正确尺度重写 */
rep("    '  vec3 adv = vec3(uTime*0.0012, 0.0, 0.0);',\n" +
    "    '  vec3 q = m*0.5 + uDetOff + adv;',\n" +
    "    '  vec3 w1 = td4(q*0.62).xyz; q = q + cross(m, w1)*0.30*cyc;',\n" +
    "    '  vec3 w2 = td4(q*1.55+0.17).xyz; q = q + cross(m, w2)*0.11*cyc;',\n" +
    "    '  float f = tf3(q*1.35*cyc);',\n" +
    "    '  if(uCloudDetail>0.5) f += td4(q*9.0+0.41).a*0.22 + td4(q*21.0+0.77).r*0.12;',",
    "    '  vec3 adv = vec3(uTime*0.00012, 0.0, 0.0);',\n" +
    "    '  vec3 q = m*0.045*cyc + uDetOff + adv;',\n" +
    "    '  vec3 w1 = td4(q*0.9).xyz; q += cross(m, w1)*0.013*cyc;',\n" +
    "    '  vec3 w2 = td4(q*2.2+0.17).xyz; q += cross(m, w2)*0.005*cyc;',\n" +
    "    '  float f = tf3(q);',\n" +
    "    '  if(uCloudDetail>0.5) f += td4(q*7.0+0.41).a*0.20 + td4(q*17.0+0.77).r*0.10;',");
rep("    '  float cyc = max(uSty1.x, 0.3); vec3 q = m*0.5 + uDetOff;',\n" +
    "    '  q = q + cross(m, td4(q*0.62).xyz)*0.30*cyc;',\n" +
    "    '  float f = td4(q*1.35*cyc).r*0.62 + td4(q*2.8*cyc+0.31).g*0.32;',",
    "    '  float cyc = max(uSty1.x, 0.3); vec3 q = m*0.045*cyc + uDetOff;',\n" +
    "    '  q += cross(m, td4(q*0.9).xyz)*0.013*cyc;',\n" +
    "    '  float f = td4(q).r*0.62 + td4(q*2.0+0.31).g*0.32;',");

/* 其余全部按 /32 修正 */
var fix = [
  ["'    float r1=1.0-abs(td(n*9.2+uDetOff));',", "'    float r1=1.0-abs(td(n*0.29+uDetOff));',"],
  ["'    float p1=1.0-abs(td4(n*82.0+uDetOff).g);',", "'    float p1=1.0-abs(td4(n*2.6+uDetOff).g);',"],
  ["'    float w=td(n*6.7+uDetOff);',", "'    float w=td(n*0.21+uDetOff);',"],
  ["'    b += td4(n*302.0+uDetOff).b*0.16;',", "'    b += td4(n*9.5+uDetOff).b*0.16;',"],
  ["'    float pl=td4(n*68.0+uDetOff).a;',", "'    float pl=td4(n*2.1+uDetOff).a;',"],
  ["'    b += smoothstep(0.80,1.0, 1.0-abs(td4(n*60.0+uDetOff).r))*0.60;',", "'    b += smoothstep(0.80,1.0, 1.0-abs(td4(n*1.9+uDetOff).r))*0.60;',"],
  ["'      float patchN = 0.5+0.5*(td4(n*(19.0+uSty1.z*6.0)+uDetOff).r*0.7 + td4(n*(41.0+uSty1.z*9.0)+uDetOff).g*0.3);',",
   "'      float patchN = 0.5+0.5*(td4(n*(0.60+uSty1.z*0.20)+uDetOff).r*0.7 + td4(n*(1.30+uSty1.z*0.28)+uDetOff).g*0.3);',"],
  ["'      if(uDetail>0.02) vc *= 1.0 + td4(n*112.0+uDetOff).b*0.16*uDetail;',", "'      if(uDetail>0.02) vc *= 1.0 + td4(n*3.5+uDetOff).b*0.16*uDetail;',"],
  ["'      vec3 rockC = mix(vec3(0.33,0.30,0.27), vec3(0.62,0.58,0.50), 0.5+0.5*(td4(n*9.5+uDetOff).a*0.7+td4(n*20.0+uDetOff).r*0.3));',",
   "'      vec3 rockC = mix(vec3(0.33,0.30,0.27), vec3(0.62,0.58,0.50), 0.5+0.5*(td4(n*0.30+uDetOff).a*0.7+td4(n*0.63+uDetOff).r*0.3));',"],
  ["'      float dry = smoothstep(0.45,0.85, 0.5+0.5*td4(n*28.0+uDetOff).g + (1.0-moist)*0.5)*(1.0-veg)*(1.0-smoothstep(0.5,0.8,climate))*0.5;',",
   "'      float dry = smoothstep(0.45,0.85, 0.5+0.5*td4(n*0.90+uDetOff).g + (1.0-moist)*0.5)*(1.0-veg)*(1.0-smoothstep(0.5,0.8,climate))*0.5;',"],
  ["'      vec3 cw = normalize(n + cross(n, td4(n*0.27+uDetOff).xyz)*0.30);',\n'      float cur = td4(cw*vec3(0.35,0.95,0.35)+uDetOff).r*0.6 + td4(cw*vec3(0.8,2.1,0.8)+uDetOff).g*0.4;',",
   "'      vec3 cw = normalize(n + cross(n, td4(n*0.05+uDetOff).xyz)*0.30);',\n'      float cur = td4(cw*vec3(0.05,0.14,0.05)+uDetOff).r*0.6 + td4(cw*vec3(0.11,0.30,0.11)+uDetOff).g*0.4;',"],
  ["'    if(uDetail>0.004){ col *= mix(1.0, 0.965+0.07*td4(n*143.0+uDetOff).b+0.025*td4(n*570.0+uDetOff).a, uDetail); }',",
   "'    if(uDetail>0.004){ col *= mix(1.0, 0.965+0.07*td4(n*4.5+uDetOff).b+0.025*td4(n*18.0+uDetOff).a, uDetail); }',"],
  ["'  float climate = clamp(lat*lat*1.2 + elev*uIceHeight*0.45 + 0.08*td(n*0.95+uDetOff), 0.0, 1.0);',",
   "'  float climate = clamp(lat*lat*1.2 + elev*uIceHeight*0.45 + 0.08*td(n*0.030+uDetOff), 0.0, 1.0);',"],
  ["lat + 0.05*td(n*1.3+uDetOff) + elev*0.12*uIceHeight", "lat + 0.05*td(n*0.040+uDetOff) + elev*0.12*uIceHeight"],
  ["lat+0.04*td(n*1.45+uDetOff)", "lat+0.04*td(n*0.045+uDetOff)"]
];
fix.forEach(function (p) { rep(p[0], p[1]); });

fs.writeFileSync(F, s);
console.log('ok');
