/* 一次性改写脚本：生命/海洋那一支里**只影响颜色**的噪声改成采样（高度场不动，CPU 侧无需跟改）。跑完就删。 */
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

/* 陆地：群区斑块 / 林内明暗 / 岩石色 / 旱地斑 —— 全是反照率，换采样 */
rep("    '      float patchN = 0.5+0.5*sn2(n*(120.0+uSty1.z*40.0)+17.0, 2);',",
    "    '      float patchN = 0.5+0.5*(td4(n*(19.0+uSty1.z*6.0)+uDetOff).r*0.7 + td4(n*(41.0+uSty1.z*9.0)+uDetOff).g*0.3);',");
rep("    '      if(uDetail>0.02) vc *= 1.0 + (snoise(n*700.0+8.0))*0.16*uDetail;',",
    "    '      if(uDetail>0.02) vc *= 1.0 + td4(n*112.0+uDetOff).b*0.16*uDetail;',");
rep("    '      vec3 rockC = mix(vec3(0.33,0.30,0.27), vec3(0.62,0.58,0.50), 0.5+0.5*sn2(n*60.0+5.0,2));',",
    "    '      vec3 rockC = mix(vec3(0.33,0.30,0.27), vec3(0.62,0.58,0.50), 0.5+0.5*(td4(n*9.5+uDetOff).a*0.7+td4(n*20.0+uDetOff).r*0.3));',");
rep("    '      float dry = smoothstep(0.45,0.85, 0.5+0.5*snoise(n*180.0+9.0) + (1.0-moist)*0.5)*(1.0-veg)*(1.0-smoothstep(0.5,0.8,climate))*0.5;',",
    "    '      float dry = smoothstep(0.45,0.85, 0.5+0.5*td4(n*28.0+uDetOff).g + (1.0-moist)*0.5)*(1.0-veg)*(1.0-smoothstep(0.5,0.8,climate))*0.5;',");
/* 海面：洋流色差 */
rep("    '      vec3 cw = curlW(n, 1.7, 0.30);',\n    '      float cur = sn2(cw*vec3(2.2,6.0,2.2)+11.0, 3);',",
    "    '      vec3 cw = normalize(n + cross(n, td4(n*0.27+uDetOff).xyz)*0.30);',\n" +
    "    '      float cur = td4(cw*vec3(0.35,0.95,0.35)+uDetOff).r*0.6 + td4(cw*vec3(0.8,2.1,0.8)+uDetOff).g*0.4;',");
/* 通用：高频反照率斑点（所有类型共用的那一层） */
rep("    '    if(uDetail>0.004){ col *= mix(1.0, 0.965+0.07*snoise(n*900.0)+0.025*snoise(n*3600.0), uDetail); }',",
    "    '    if(uDetail>0.004){ col *= mix(1.0, 0.965+0.07*td4(n*143.0+uDetOff).b+0.025*td4(n*570.0+uDetOff).a, uDetail); }',");
/* 气候噪声（所有类型共用） */
rep("    '  float climate = clamp(lat*lat*1.2 + elev*uIceHeight*0.45 + 0.08*snoise(n*6.0), 0.0, 1.0);',",
    "    '  float climate = clamp(lat*lat*1.2 + elev*uIceHeight*0.45 + 0.08*td(n*0.95+uDetOff), 0.0, 1.0);',");
/* 雪线抖动 */
rep("    '    if(KIND_NOT_ICE){ float ice = smoothstep(uIceLat-0.05, uIceLat+0.03, lat + 0.05*snoise(n*8.0) + elev*0.12*uIceHeight)*(1.0-steep*0.75);',",
    "    '    if(KIND_NOT_ICE){ float ice = smoothstep(uIceLat-0.05, uIceLat+0.03, lat + 0.05*td(n*1.3+uDetOff) + elev*0.12*uIceHeight)*(1.0-steep*0.75);',");
/* 海冰边缘抖动 */
rep("    '      float sice=smoothstep(uIceLat+0.02, uIceLat+0.09, lat+0.04*snoise(n*9.0));",
    "    '      float sice=smoothstep(uIceLat+0.02, uIceLat+0.09, lat+0.04*td(n*1.45+uDetOff));");

fs.writeFileSync(F, s);
console.log('ok');
