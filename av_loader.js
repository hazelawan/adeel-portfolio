// Combines chunks into video blob
(function(){
  var b64 = window.AVCHUNK0 + window.AVCHUNK1 + window.AVCHUNK2;
  var bin = atob(b64);
  var arr = new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  var url = URL.createObjectURL(new Blob([arr],{type:'video/mp4'}));
  var v = document.getElementById('avatarVideo');
  if(v){ v.src=url; v.load(); }
})();
