# 人生的中点｜代码渲染短片

Canvas 绘制 1920×1080、30fps 的 MP4。星点、轨道和颗粒均由代码生成；随机元素使用固定种子，画面不依赖 `Math.random` 或 `Date.now`。

## 分析 BGM

```powershell
$env:FFMPEG_PATH = 'C:\path\to\ffmpeg.exe'
npm run analyze:bgm -- .\运气的形状_BGM.mp3
```

脚本把音频解码成单声道 PCM，计算 10ms RMS/高频瞬态包络并做自相关，估计 BPM 和拍点相位；以每四拍为一个小节网格，再为场景切换找最近的拍点。开场标题转场和星点脉冲也使用同一拍点网格。

当前这首 BGM 估计为 75.2 BPM，拍长约 0.798 秒。11 个场景切点为 9.91、19.49、29.06、38.64、51.41、60.99、70.57、80.15、89.73、99.31、108.88 秒。

## 渲染完整短片

项目目录中需要 `运气的形状_BGM.mp3`、Edge 和支持 `h264_mf` 的 FFmpeg：

```powershell
$env:EDGE_PATH = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:FFMPEG_PATH = 'C:\path\to\ffmpeg.exe'
npm run render -- --duration 120 --output final_120s.mp4
```

输出为 `final_120s.mp4`，并把 12 个场景的检查静帧写入 `stills_full/`。默认 10 秒样片仍可用 `npm run render` 生成。

## 本项目的已知情况

- BGM 检测到的主周期约为 75.2 BPM（拍长约 0.798 秒）；这是基于瞬态能量包络的算法估计，曲目中的半拍/双拍解释及乐句强拍相位仍可能存在歧义。
- 所提供 BGM 约 130.04 秒；120 秒成片从开头使用，并在最后 2 秒淡出。
- 输出包含音乐，不含旁白；音乐不会被拉伸或变速。
