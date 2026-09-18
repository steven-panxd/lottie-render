// Measure cgroup peak memory including Chromium, FFmpeg and charged file cache.
// Usage: node scripts/benchmark-container.cjs IMAGE OUTPUT_DIRECTORY
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const image = process.argv[2];
const output = path.resolve(process.argv[3] || 'videos/container-benchmark');
if (!image) throw Error('Pass a locally built Docker image');
fs.mkdirSync(output, { recursive: true });
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/demo-animation.json')));
// Longer shape animation. This is a stress fixture, not a production compatibility claim.
const long = JSON.parse(JSON.stringify(sample));
long.fr = 60; long.op = 600; long.w = 512; long.h = 512;
for (const layer of long.layers) layer.op = 600;
fs.writeFileSync(path.join(output, 'sample.json'), JSON.stringify(sample));
fs.writeFileSync(path.join(output, 'long.json'), JSON.stringify(long));
const runner = `
const fs=require('fs'); const {renderLottie}=require('/app/dist');
(async()=>{
 const result=await renderLottie('/bench/'+process.env.INPUT,{outputPath:'/bench/'+process.env.RESULT+'.mp4',backgroundColor:'#ffffff',...(process.env.RESAMPLE==='1'?{fps:30,frameRateMode:'resample'}:{})});
 const report={success:result.success,error:result.error,renderMs:result.duration,metadata:result.metadata};
 try {report.cgroupPeakBytes=Number(fs.readFileSync('/sys/fs/cgroup/memory.peak','utf8'));report.memoryEvents=fs.readFileSync('/sys/fs/cgroup/memory.events','utf8');}catch(e){report.measurementError=e.message;}
 if(result.success){report.video=JSON.parse(require('child_process').execFileSync('ffprobe',['-v','error','-count_frames','-show_entries','stream=nb_read_frames,width,height,duration,codec_name','-of','json',result.videoPath],{encoding:'utf8'})).streams[0];}
 fs.writeFileSync('/bench/'+process.env.RESULT+'.json',JSON.stringify(report,null,2));
 if(!result.success)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});`;
fs.writeFileSync(path.join(output, 'runner.cjs'), runner);
const reports = [];
for (const memory of ['512m', '1g']) {
  for (const input of ['sample.json', 'long.json']) {
    const modes = image.includes('baseline') ? [false] : [false, true];
    for (const resample of modes) {
      const id = [image.replace(/[^a-z0-9]/gi, '-'),memory,input.replace('.json',''),resample?'resample':'source'].join('-');
      const name = id + '-' + Date.now();
      const started = Date.now();
      const proc = spawnSync('docker',['run','--name',name,'--init','--network','none','--memory',memory,'--memory-swap',memory,'--cpus','1',
        '-v',output+':/bench','-e','INPUT='+input,'-e','RESULT='+id,'-e','RESAMPLE='+(resample?'1':'0'),image,'node','/bench/runner.cjs'],{encoding:'utf8',timeout:180000});
      let state;
      try { state=JSON.parse(execFileSync('docker',['inspect',name,'--format','{{json .State}}'],{encoding:'utf8'})); }
      finally { spawnSync('docker',['rm','-f',name]); }
      fs.writeFileSync(path.join(output,id+'.log'),(proc.stdout||'')+'\n'+(proc.stderr||''));
      const file=path.join(output,id+'.json');
      const report={image,memory,input,resample,exitCode:proc.status,wallMs:Date.now()-started,oomKilled:state?.OOMKilled,
        ...(fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{} )};
      reports.push(report); console.log(JSON.stringify(report));
    }
  }
}
fs.writeFileSync(path.join(output,image.replace(/[^a-z0-9]/gi,'-')+'-summary.json'),JSON.stringify({measuredAt:new Date().toISOString(),imageId:execFileSync('docker',['image','inspect',image,'--format','{{.Id}}'],{encoding:'utf8'}).trim(),method:'One run per case; 1 CPU, swap disabled, cgroup v2 memory.peak includes all child processes and charged filesystem cache. Docker Desktop Linux arm64. Cold browser per job; no container network.',reports},null,2));
