const $=s=>document.querySelector(s);
export function syncPublishComposer(){
 const form=$('#form');if(!form)return;
 const file=$('#file').files[0],title=$('#title').value,price=$('#price'),token=$('#token'),burn=$('#content-burn').checked,secs=$('#secs'),target=$('#publish-target'),preview=$('#show-preview');
 $('#publish-title-count').textContent=title.length+' / 40';
 $('#publish-file-name').textContent=file?file.name:'尚未选择图片';
 $('#publish-file-meta').textContent=file?`${(file.size/1024).toFixed(file.size<1024?1:0)} KB · ${file.type.replace('image/','').toUpperCase()}`:'PNG、JPEG、WebP、GIF · 最大 2 MB';
 $('#clear-upload').textContent=file?'更换图片':'选择图片';
 $('#publish-duration-row').classList.toggle('hidden',!burn);secs.disabled=!burn;
 if(!burn&&(!Number.isInteger(Number(secs.value))||Number(secs.value)<3||Number(secs.value)>3600))secs.value='10';
 const label=target.selectedOptions[0]?.textContent||'创作者广场';
 $('#publish-review-target').textContent=target.value==='public'?'创作者广场':label.replace(/^仅当前(私聊|群聊)：/,'');
 $('#publish-audience-help').textContent=target.value==='public'?'作品信息会出现在广场，图片需付费解锁。':'仅当前会话成员可购买和查看，不会发布到广场。';
 $('#publish-review-access').textContent=`${Number(price.value)>0?price.value:'—'} ${token.value} · ${burn?'查看 '+secs.value+' 秒':'24 小时内可重复查看'}`;
 $('#publish-access-help').textContent=burn?'付款后 24 小时内可打开；限时从首次打开开始，无法阻止截图。':'付款后 24 小时内可重复打开。已保存的图片无法收回。';
 $('#publish-preview-note').textContent=preview.checked?'允许公开低清模糊预览，原图仍需付费解锁。':'默认不公开图片预览，付款解锁后才能查看。';
 $('#publish-preview-help').textContent=preview.disabled?'当前模式暂不支持公开模糊预览。':'默认关闭，未解锁前不展示图片。';
 const valid=!!file&&!!title.trim()&&price.validity.valid&&Number(price.value)>0&&(!burn||secs.validity.valid)&&$('#max').validity.valid;
 $('#publish-submit-label').textContent=form.dataset.sending==='true'?'正在发布…':'发布图片';
 form.querySelector('[type=submit]').disabled=!valid||form.dataset.sending==='true';
 $('#publish-readiness').textContent=!file?'先选择一张图片。':!title.trim()?'写一句配文后即可发布。':!valid?'请检查价格、时长或可售份数。':'请确认发布对象和解锁规则。';
}
export function initPublishComposer(){
 const form=$('#form');form.addEventListener('input',syncPublishComposer);form.addEventListener('change',syncPublishComposer);
 const stage=$('.publish-image-stage');
 for(const event of ['dragenter','dragover'])stage.addEventListener(event,e=>{e.preventDefault();stage.classList.add('drag-over');});
 stage.addEventListener('dragleave',e=>{if(!stage.contains(e.relatedTarget))stage.classList.remove('drag-over');});
 stage.addEventListener('drop',e=>{e.preventDefault();stage.classList.remove('drag-over');const file=e.dataTransfer?.files[0];if(!file)return;const data=new DataTransfer();data.items.add(file);$('#file').files=data.files;$('#file').dispatchEvent(new Event('change',{bubbles:true}));});
 syncPublishComposer();
}
