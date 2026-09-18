/* 一次性改写脚本：细节贴图的 uniform 与绑定。跑完就删。 */
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

/* use() 支持 3D 贴图：数组里传 {tex3: …} 就按 TEXTURE_3D 绑 */
rep("    if (textures) for (var i = 0; i < textures.length; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, textures[i]); }",
    "    if (textures) for (var i = 0; i < textures.length; i++) { var te = textures[i]; gl.activeTexture(gl.TEXTURE0 + i);\n" +
    "      if (te && te.tex3) gl.bindTexture(gl.TEXTURE_3D, te.tex3); else gl.bindTexture(gl.TEXTURE_2D, te); }");
rep("  GLR.prototype.detailTex = function () {",
    "  GLR.prototype.det3 = function () { return { tex3: this.detailTex() }; };\n" +
    "  GLR.prototype.detailTex = function () {");

/* uniform：贴图单元 4 + 每颗行星的偏移 */
rep("      uDetail: 1, uOctF: 1, uAlpha: 1 };", "      uDetail: 1, uOctF: 1, uAlpha: 1, uDetTex: 4 };");
rep("    return { uSurfKind: k, uSty0: s0, uSty1: [st.cycloneF, st.cloudMul, st.contFreq, st.riftAmt], uSea2: [st.shelfW, st.currentAmt], uDepositC: dep, uCrackC: crk };",
    "    return { uSurfKind: k, uSty0: s0, uSty1: [st.cycloneF, st.cloudMul, st.contFreq, st.riftAmt], uSea2: [st.shelfW, st.currentAmt], uDepositC: dep, uCrackC: crk, uDetOff: st.detOff };");
rep("    st.storms = [];",
    "    /* 这颗行星在那张公共细节贴图里的取样偏移：同一张贴图，靠偏移长出不同的星球 */\n" +
    "    st.detOff = [rnd() * 7.13, rnd() * 5.77, rnd() * 9.31];\n" +
    "    st.storms = [];");

/* 绑定：凡是用到 GLSL_SURF 的程序都要把细节贴图挂到 4 号单元 */
rep("        R.use(globeProgFor(vp), mu2, [g.perm, g.map, g.pal]); gl.bindVertexArray(R.sphereVAO);",
    "        R.use(globeProgFor(vp), mu2, [g.perm, g.map, g.pal, g.pal, R.det3()]); gl.bindVertexArray(R.sphereVAO);");
rep("        R.use(globeProg, mu, [g.perm, g.mapOld, g.pal, g.city || g.pal]);",
    "        R.use(globeProg, mu, [g.perm, g.mapOld, g.pal, g.city || g.pal, R.det3()]);");
rep("        mu.uMapSize = [g.maps.W, g.maps.H]; mu.uAlpha = g.fade;\n        R.use(globeProg, mu, [g.perm, g.map, g.pal, g.city || g.pal]);",
    "        mu.uMapSize = [g.maps.W, g.maps.H]; mu.uAlpha = g.fade;\n        R.use(globeProg, mu, [g.perm, g.map, g.pal, g.city || g.pal, R.det3()]);");
rep("        R.use(globeProg, mu, [g.perm, g.map, g.pal, g.city || g.pal]); gl.drawElements(gl.TRIANGLES, R.sphereN, gl.UNSIGNED_SHORT, 0);\n      }",
    "        R.use(globeProg, mu, [g.perm, g.map, g.pal, g.city || g.pal, R.det3()]); gl.drawElements(gl.TRIANGLES, R.sphereN, gl.UNSIGNED_SHORT, 0);\n      }");
rep("        R.use(globeProgFor(mvp), mmu, [mg.perm, mg.map, mg.pal]);",
    "        R.use(globeProgFor(mvp), mmu, [mg.perm, mg.map, mg.pal, mg.pal, R.det3()]);");
rep("      R.use(R.ready('globeK5') ? 'globeK5' : 'globeLo', mu, [g.perm, g.map, g.pal]);",
    "      R.use(R.ready('globeK5') ? 'globeK5' : 'globeLo', mu, [g.perm, g.map, g.pal, g.pal, R.det3()]);");
rep("      R.use(terrProg, mu, [g.perm, g.map, g.pal, g.city || g.pal]);",
    "      R.use(terrProg, mu, [g.perm, g.map, g.pal, g.city || g.pal, R.det3()]);");
rep("        R.use('water', mu, [g.perm, g.map, g.pal]);", "        R.use('water', mu, [g.perm, g.map, g.pal, g.pal, R.det3()]);");
rep("        mu.uHm = clamp(Rm * 0.0013, 3000, 12000); R.use('cloud', mu, [g.perm, g.map, g.pal]);",
    "        mu.uHm = clamp(Rm * 0.0013, 3000, 12000); R.use('cloud', mu, [g.perm, g.map, g.pal, g.pal, R.det3()]);");
rep("        mu.uHm *= 1.75; mu.uCloudRot += 0.37; mu.uCloud *= 0.7; R.use('cloud', mu, [g.perm, g.map, g.pal]);",
    "        mu.uHm *= 1.75; mu.uCloudRot += 0.37; mu.uCloud *= 0.7; R.use('cloud', mu, [g.perm, g.map, g.pal, g.pal, R.det3()]);");

fs.writeFileSync(F, s);
console.log('ok');
