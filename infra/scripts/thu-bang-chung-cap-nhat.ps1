<#
  Thu BẰNG CHỨNG về lượt tự cập nhật trên MỘT máy — chỉ đọc, không sửa gì.

  Vì sao nó tồn tại. Đo 10/09 trên log máy chủ: 2 trong 4 máy đang chạy Bot Nội Bộ CÓ hỏi cửa cập
  nhật và trượt, ở HAI chặng khác hẳn nhau — một máy tải đứt ở 22/106 MB, một máy tải trọn 106 MB
  hai lần rồi vẫn ở bản cũ. Máy chủ không phân biệt được hai ca đó: cả hai chỉ để lại một dòng
  `200` rồi im. Bằng chứng nằm TRÊN máy, và đây là thứ đi lấy nó.

  Bản launcher đang chạy trên các máy ấy (`0.43.20260909` trở về trước) hỏng thì `exit 0` không
  ghi gì — nhưng nó để lại hai dấu vết mà chính nó không cố ý:

    · tải đứt giữa chừng ⇒ `Invoke-WebRequest -OutFile` ném, `catch` không xoá file
      ⇒ **còn một tệp DỞ DANG trong %TEMP%**, và cỡ của nó nói đứt ở đâu.
      (băm lệch thì khác: nhánh ấy CÓ `Remove-Item`, nên không còn file)
    · pha 2 chạy được ⇒ `%TEMP%\bot-noi-bo-cap-nhat.ps1` **không bao giờ bị xoá**,
      và biến `$d` trong đó khai đúng thư mục nó đã `/DIR=` vào.

  Cách chạy — mở PowerShell trên máy cần chẩn đoán rồi:

      powershell -NoProfile -ExecutionPolicy Bypass -File .\thu-bang-chung-cap-nhat.ps1

  Thêm `-ThuTai` nếu muốn nó DỰNG LẠI lượt tải để xem đứt ở đâu (tốn ~106 MB băng thông của máy
  đó, tệp tải về bị xoá ngay sau khi đo). Mặc định TẮT: một bộ thu bằng chứng không được tự ý
  tiêu băng thông của người khác.

  Nó KHÔNG BAO GIỜ in: nội dung `token.txt` (chỉ độ dài), và tên người dùng Windows trong đường
  dẫn (thay bằng `<user>`). Đầu ra chép nguyên về được.
#>
[CmdletBinding()]
param(
  # Dựng lại lượt tải để xem nó đứt ở byte nào. Tốn băng thông — chỉ bật khi đã muốn biết.
  [switch]$ThuTai
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'   # thanh tiến độ của IWR làm chậm tải rất nhiều

# Bộ thu này hỏi cửa `/updates/ban-moi`, và cửa ấy GHI một hàng vào sổ đội máy. Đi bằng UA mặc
# định của `Invoke-WebRequest` thì `chuanUa()` xếp nó vào PowerShell/5.1.* và đếm nó là MỘT LƯỢT
# LAUNCHER THẬT — tức một phép đo tự bịa ra dữ liệu rồi báo cáo lại chính nó. Đúng họ hàng rác
# "Máy cũ" (§7) và họ "coverage đếm cả lượt của bài đo". Tự khai danh thì hàng vẫn được giữ
# (mục 50 cố ý giữ hàng không-phải-launcher, CÓ NHÃN) mà không lọt vào phép đếm "N/M máy".
$UA = 'grokbot2-thu-bang-chung/1'

# Dong Tls12 nay dung va re nen giu, NHUNG dung doc no nhu loi giai thich cho "timed out". Ban
# dau toi viet o day rang PS 5.1 thieu TLS 1.2 nen bat tay hong ra thanh het gio; dat Tls12
# KHONG chua duoc gi, tuc cau ay la mot loi giai thich nghe co ly viet TRUOC khi do. Nguyen nhan
# that o muc DUONG RA MANG duoi.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.ServicePointManager]::SecurityProtocol } catch {}

# Ngan xep HTTP cua .NET va cua `curl` KHONG cung hanh vi, va cho khac nhau ay chinh la thu bo thu
# nay phai do. Do 10/09 tren may 19041.6456 (mot trong 4 may trong so doi may):
#   . TCP 443 toi CA HAI dia chi AAAA cua Cloudflare: HO DEN 21 s moi cai (khong tra loi, khong tu choi)
#   . `Dns.GetHostAddresses` xep AAAA len TRUOC — dung luat, may co dia chi IPv6 toan cuc + duong ra ::/0
#   . `ServicePoint` cua .NET thu LAN LUOT ==> Invoke-WebRequest ve sau 42,5 s
#   . `curl` dua song song v4/v6 (Happy Eyeballs, RFC 8305) ==> ve sau 0,71 s; voi `-4` thi 0,31 s
#
# Nen bo thu LAY du kien bang mot ngan xep KHAC (curl.exe cua Windows) va DO ngan xep cua san pham
# (Invoke-WebRequest) nhu mot doi tuong rieng. Di bang chinh ngan xep dang hong thi no bao "feed
# hong" tren mot may co feed hoan toan lanh; di bang curl khong thoi thi no khong bao gio thay cai
# loi ma nguoi dung dang gap. Mot bo do dang do mot ngan xep thi khong duoc dung chinh ngan xep ay.
$CURL = Join-Path $env:SystemRoot 'System32\curl.exe'   # co san tu Windows 10 build 17063
$COCURL = (Test-Path $CURL)

$CHO = 40      # tran cho mot luot LAY du kien (curl) — rong tay cho mot lan bat tay lanh
$CHO_DO = 90   # tran cho luot DO ngan xep .NET — phai LON HON 2 x 21 s ho den, khong thi phep do
               # chi noi duoc "het gio" chu khong noi duoc het gio O DAU

# Ban CHEP cua tran launcher dat cho luot hoi feed (`-TimeoutSec 8` trong setup-exe.mjs). No o day
# de phep do ket luan duoc, va vi la ban chep nen doi o kia thi phai doi ca o day — dong nay tu
# khai the ra de lan sau khong ai phai doan.
$TRAN_LAUNCHER = 8

# URL cua ta co mang `&k=<token>`, nen no khong duoc nam trong DONG LENH: mot dong lenh la mot cho
# ro — `tasklist`, so su kien, va log cua phan mem khac deu doc duoc. `curl -K <tep>` nhan tuy chon
# tu mot TEP, nen token chi di qua mot tep trong TEMP cua chinh nguoi dung (cung cho `token.txt` da
# nam san) va bi xoa ngay trong `finally`.
#
# Duong `-K -` (doc tu STDIN) trong hon va da thu TRUOC: PowerShell 5.1 dan mot BOM vao dau ong,
# nen curl doc dong dau thanh "<BOM>silent" va bao `'silent' is unknown`. Ghi tep bang
# `UTF8Encoding($false)` la het doan ve ma hoa.
#
# VA MOT BAY DAT HON, do 10/09: trong tep cau hinh cua curl, mot gia tri trong NHAY KEP thi `\` la
# dau ESCAPE — nen `output = "C:\Users\...\Temp\tmp1.tmp"` co `\t` thanh TAB va curl ghi vao mot
# duong dan KHAC. No hong theo cach im lang nhat co the: curl tra **200**, **exit 0**,
# `size_download=204`, ma tep dich **0 byte** — roi `ConvertFrom-Json` tren chuoi rong tra `$null`,
# nen bo thu in "goi duoc phat" rong va sau do bao `HEAD hong: curl thoat 26` (url rong). MOT goc,
# HAI trieu chung, va khong dong loi nao. Nhan doi backslash thi 204 byte ve dung cho. Cung ho bay
# `\B` va `String.raw` da tra gia (§7): mot backslash trong khuon sinh tep Windows phai viet doi.
#
# Nen KHONG ai duoc tu tay viet mot dong `khoa = "gia tri"` nua: `CurlCfg` nhan CO (chuoi tran) va
# CAP (mang hai phan tu) roi TU nhay, TU nhan doi. Cam cai HINH DANG thi khong con cho de quen —
# cung luat §7 da dung cho `Excludes` cua Inno va cho `join(HERE,"..",".data")`.
$BS = [string][char]92

function CurlCfg([object[]]$muc) {
  $dong = New-Object 'System.Collections.Generic.List[string]'
  foreach ($m in $muc) {
    if ($m -is [array]) { $dong.Add([string]$m[0] + ' = "' + ([string]$m[1]).Replace($BS, $BS + $BS) + '"') }
    else { $dong.Add([string]$m) }
  }
  $f = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($f, (($dong -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))
  return $f
}

function Hoi([string]$u, [switch]$ChiDau) {
  $t = Get-Date
  # Mot URL rong khong duoc di toi curl: no bao `option -K: error encountered when reading a file`,
  # mot cau chu tro sang tep cau hinh chu khong tro vao cho that.
  if (-not $u) { return @{ loi = 'khong co URL de hoi (than reply truoc do rong?)'; giay = 0; qua = '-' } }
  if ($COCURL) {
    $ra = [IO.Path]::GetTempFileName()
    $muc = New-Object 'System.Collections.Generic.List[object]'
    $muc.Add('silent')
    $muc.Add(@('user-agent', $UA))
    $muc.Add(@('max-time', $CHO))
    $muc.Add(@('output', $ra))
    $muc.Add(@('write-out', '%{http_code}'))
    if ($ChiDau) { $muc.Add('head') }
    $muc.Add(@('url', $u))
    $f = CurlCfg $muc
    try { $ma = & $CURL -K $f; $maThoat = $LASTEXITCODE } finally { Remove-Item $f -Force -ErrorAction SilentlyContinue }
    $than = ''
    if (Test-Path $ra) {
      $than = (Get-Content $ra -Raw -ErrorAction SilentlyContinue)
      Remove-Item $ra -Force -ErrorAction SilentlyContinue
    }
    $giay = ((Get-Date) - $t).TotalSeconds
    if ($maThoat -ne 0) { return @{ loi = ('curl thoat ' + $maThoat); giay = $giay; qua = 'curl' } }
    return @{ ma = [int]("$ma".Trim()); than = $than; giay = $giay; qua = 'curl' }
  }
  try {
    $p = @{ UseBasicParsing = $true; UserAgent = $UA; TimeoutSec = $CHO_DO; Uri = $u }
    if ($ChiDau) { $p['Method'] = 'Head' }
    $r = Invoke-WebRequest @p
    return @{ ma = [int]$r.StatusCode; than = $r.Content; hd = $r.Headers; giay = ((Get-Date) - $t).TotalSeconds; qua = 'iwr' }
  } catch {
    return @{ loi = ($_.Exception.GetType().Name + ': ' + $_.Exception.Message); giay = ((Get-Date) - $t).TotalSeconds; qua = 'iwr' }
  }
}

# Che tên người dùng: đầu ra này được chép qua chat, đường dẫn không cần khai ai đang đăng nhập.
function Che([string]$s) {
  if (-not $s) { return $s }
  $s = $s -replace [regex]::Escape($env:USERNAME), '<user>'
  return $s
}
function Muc([string]$t) { Write-Output ''; Write-Output ("=== $t " + ('=' * [Math]::Max(0, 58 - $t.Length))) }
function Dong([string]$k, $v) { Write-Output ('  {0,-22} {1}' -f $k, $v) }
function Gio($d) { if ($d) { (Get-Date $d -Format 'dd/MM HH:mm:ss') } else { '-' } }

Write-Output '########## BANG CHUNG LUOT TU CAP NHAT — chi doc, khong sua gi ##########'
Dong 'thu luc' (Get-Date -Format 'dd/MM/yyyy HH:mm:ss zzz')

Muc 'MAY'
# Chuoi nay khop voi cot `ua` trong so doi may o /admin: launcher di bang Invoke-WebRequest nen
# User-Agent cua no mang dung so nay. Thieu no thi khong biet dang doc hang nao.
Dong 'PowerShell' $PSVersionTable.PSVersion.ToString()
Dong 'Windows' ((Get-CimInstance Win32_OperatingSystem).Caption + ' build ' + [Environment]::OSVersion.Version.Build)
Dong 'TEMP' (Che $env:TEMP)

# --- Tim moi ban cai ------------------------------------------------------------------------
# Khong doan MOT duong dan: mot may co the mang ca ban cho-app lan ban cau hinh, va cai hong
# thuong la "cai dung vao thu muc SAI", nen phai ke ra ca ba de so.
$ungVien = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Bot Noi Bo'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Bot Noi Bo 043'),
  (Join-Path $env:LOCALAPPDATA 'Bot Noi Bo'),
  'C:\cai043', 'C:\cai029'
) | Select-Object -Unique
$coCai = @()
foreach ($d in $ungVien) {
  if (Test-Path (Join-Path $d 'start-bot.cmd')) { $coCai += $d }
}

Muc ('BAN CAI TIM THAY: ' + $coCai.Count)
foreach ($d in $coCai) {
  Write-Output ''
  Write-Output ('  --- ' + (Che $d))
  $lau = Join-Path $d 'start-bot.cmd'
  $s = Get-Content $lau -Raw -ErrorAction SilentlyContinue
  $item = Get-Item $lau -ErrorAction SilentlyContinue
  Dong 'start-bot.cmd' ($item.Length.ToString() + ' byte · ' + (Gio $item.LastWriteTime))

  # Doi launcher: ban tu 10/09 tro di ghi manh vun `.cap-nhat-cuoi.txt` va thu lai 3 luot.
  # Ban cu hong thi `exit 0` khong ghi gi — nen "CU" o day chinh la ly do phai chay bai nay.
  $moi = ($s -match 'cap-nhat-cuoi')
  $thuLai = ($s -match '\$lan -lt 3')
  Dong 'doi launcher' $(if ($moi) { 'MOI (co ghi ly do)' + $(if ($thuLai) { ' + thu lai 3 luot' } else { '' }) } else { 'CU — hong thi im, khong ghi ly do' })

  $pkg = Join-Path $d 'resources\app\package.json'
  if (Test-Path $pkg) {
    try { Dong 'ban trong bundle' (Get-Content $pkg -Raw | ConvertFrom-Json).version }
    catch { Dong 'ban trong bundle' 'DOC KHONG DUOC package.json' }
  } else {
    # Khong co `resources\app` = day la ban CAU HINH (50 KB): no va client cai san o cho khac.
    Dong 'ban trong bundle' '(khong co resources\app — day la ban CAU HINH)'
  }

  $be = Join-Path $d 'backend.txt'
  Dong 'backend.txt' $(if (Test-Path $be) { (Get-Content $be -Raw).Trim() } else { 'VANG' })

  # CHI do dai. Gia tri cua no la giay to — mot dong log la mot cho ro.
  $tk = Join-Path $d 'token.txt'
  if (Test-Path $tk) { Dong 'token.txt' ('co, dai ' + (Get-Content $tk -Raw).Trim().Length + ' ky tu') }
  else { Dong 'token.txt' 'VANG — may nay se nhan goi CAU HINH, khong phai goi cho-app' }

  # Moc tiet che: no duoc dong dau TRUOC khi tai, nen mot may tai hong van bi khoa 24 h.
  $moc = Join-Path $d '.lan-hoi-cuoi'
  if (Test-Path $moc) {
    $h = [int]((Get-Date) - (Get-Item $moc).LastWriteTime).TotalHours
    Dong '.lan-hoi-cuoi' ((Gio (Get-Item $moc).LastWriteTime) + "  ($h gio truoc" + $(if ($h -lt 24) { ' — DANG BI TIET CHE, lan mo toi se BO QUA cap nhat' } else { ' — het tiet che' }) + ')')
  } else { Dong '.lan-hoi-cuoi' 'VANG — chua bao gio hoi feed thanh cong tu thu muc nay' }

  $bc = Join-Path $d '.cap-nhat-cuoi.txt'
  if (Test-Path $bc) { Dong '.cap-nhat-cuoi.txt' ((Get-Content $bc -Raw).Trim()) }
  else { Dong '.cap-nhat-cuoi.txt' 'VANG (dung neu launcher con doi CU)' }
}
if ($coCai.Count -eq 0) { Write-Output '  KHONG THAY ban cai nao o cac duong dan quen thuoc.' }

# --- Dau vet trong %TEMP% -------------------------------------------------------------------
Muc 'DAU VET TRONG %TEMP%'
$goi = @(Get-ChildItem $env:TEMP -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like 'Bot-Noi-Bo-Setup-*' -or $_.Name -like 'Cai-dat-Bot-Noi-Bo-*' })
if ($goi.Count -eq 0) { Dong 'goi tai ve' 'khong con tep nao' }
foreach ($f in $goi) {
  Dong $f.Name ('{0:N0} byte ({1:N1} MB) · {2}' -f $f.Length, ($f.Length / 1MB), (Gio $f.LastWriteTime))
}

$pha2 = Join-Path $env:TEMP 'bot-noi-bo-cap-nhat.ps1'
if (Test-Path $pha2) {
  # Day la bang chung MANH NHAT cho ca "cai truot": pha 2 khong bao gio tu xoa minh, va bien $d
  # ben trong khai dung thu muc no da `/DIR=` vao. Cai vao SAI thu muc trong y het cai thanh cong.
  Write-Output ''
  Dong 'pha 2 (script cai)' ('CO · ' + (Gio (Get-Item $pha2).LastWriteTime) + ' — tuc pha 1 DA tai xong va giao viec')
  Write-Output '  --- noi dung pha 2 (chi duong dan, khong co giay to nao) ---'
  Get-Content $pha2 | ForEach-Object { Write-Output ('    ' + (Che $_)) }
} else {
  Dong 'pha 2 (script cai)' 'VANG — pha 1 chua bao gio tai xong va kiem bam xong'
}

# --- Cho trong dia --------------------------------------------------------------------------
Muc 'CHO TRONG DIA'
# Gop theo O DIA, khong theo thu muc: bon thu muc tren cung mot o thi in bon dong giong het nhau,
# va bon dong giong nhau doc len nhu bon phep do — no khong them mot dữ kien nao.
$oDia = @()
foreach ($o in @($env:TEMP) + $coCai) {
  try { $oDia += (Get-Item $o).PSDrive.Name } catch {}
}
foreach ($q in ($oDia | Select-Object -Unique)) {
  try {
    $dv = Get-PSDrive $q -ErrorAction Stop
    Dong ("o $q" + ':') ('{0:N1} GB trong / {1:N1} GB tong' -f ($dv.Free / 1GB), (($dv.Free + $dv.Used) / 1GB))
  } catch {}
}

# --- Duong ra mang -------------------------------------------------------------------------
# Vi sao muc nay ton tai: mot may co the "co mang" tron ven ma van khong hoi noi feed, va trieu
# chung duy nhat la mot dong "timed out" — thu khong phan biet duoc DNS, TLS, proxy hay mot duong
# ra CHET. Nen doi tuong do o day khong phai "co mang khong" ma la "dia chi nao duoc thu TRUOC, va
# dia chi ay co tra loi khong".
#
# Do tren TRANG GOC (`backend.txt`) chu khong tren `/updates/ban-moi`: cua feed GHI mot hang vao so
# doi may, nen do duong mang bang no la tu de ra ba hang moi luot chay.
Muc 'DUONG RA MANG TOI BACKEND'
$mayChu = @()
foreach ($d in $coCai) {
  $be = Join-Path $d 'backend.txt'
  if (Test-Path $be) {
    try { $mayChu += ([uri]((Get-Content $be -Raw).Trim())) } catch {}
  }
}
$mayChu = $mayChu | Sort-Object -Property Host -Unique
if (-not $mayChu) { Dong 'khong co backend.txt' 'khong biet phai hoi ai' }
foreach ($mc in $mayChu) {
  Write-Output ('  --- ' + $mc.Host)
  $dc = @()
  try { $dc = [Net.Dns]::GetHostAddresses($mc.Host) } catch { Dong 'DNS hong' $_.Exception.Message; continue }
  # In dung THU TU .NET nhan duoc: dia chi thu nhat la dia chi no thu dau tien.
  $n = 0
  $hoDen = 0
  foreach ($a in $dc) {
    $n++
    $ho = if ($a.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6) { 'IPv6' } else { 'IPv4' }
    $t = Get-Date
    $kq = ''
    try {
      $s = New-Object Net.Sockets.Socket($a.AddressFamily, [Net.Sockets.SocketType]::Stream, [Net.Sockets.ProtocolType]::Tcp)
      # Cong lay tu CHINH URL, khong ghim 443: mot backend o `http://localhost:8788` thi do 443 se
      # in ra mot cau "tu choi" khong noi ve dieu gi ca — mot phep do tra loi dung mot cau hoi SAI.
      $iar = $s.BeginConnect($a, $mc.Port, $null, $null)
      if ($iar.AsyncWaitHandle.WaitOne(22000)) {
        $s.EndConnect($iar)
        $kq = ('NOI DUOC sau {0:N2}s' -f ((Get-Date) - $t).TotalSeconds)
      } else {
        $kq = 'HO DEN — 22s khong tra loi, khong tu choi'
        $hoDen++
      }
      $s.Close()
    } catch {
      $kq = ('tu choi sau {0:N2}s : {1}' -f ((Get-Date) - $t).TotalSeconds, $_.Exception.InnerException.SocketErrorCode)
    }
    Write-Output ('    {0}. {1,-4} {2,-42} {3}' -f $n, $ho, $a.IPAddressToString, $kq)
  }

  # Hai ngan xep, cung mot URL: cho lech giua chung la cho san pham dang chet.
  $goc = $mc.AbsoluteUri
  if ($COCURL) {
    $tepRa = Join-Path ([IO.Path]::GetTempPath()) 'thu-duong.tmp'
    foreach ($co in @('', '-4')) {
      $t = Get-Date
      $muc = New-Object 'System.Collections.Generic.List[object]'
      $muc.Add('silent')
      $muc.Add(@('output', $tepRa))
      $muc.Add(@('write-out', '%{http_code}'))
      $muc.Add(@('max-time', $CHO))
      $muc.Add(@('user-agent', $UA))
      $muc.Add(@('url', $goc))
      if ($co) { $muc.Add('ipv4') }
      $f = CurlCfg $muc
      try { $ma = & $CURL -K $f } finally { Remove-Item $f -Force -ErrorAction SilentlyContinue }
      Write-Output ('    curl {0,-11} {1} sau {2:N2}s' -f $(if ($co) { 'chi IPv4' } else { '(mac dinh)' }), ("$ma".Trim()), ((Get-Date) - $t).TotalSeconds)
    }
    Remove-Item $tepRa -Force -ErrorAction SilentlyContinue
  } else {
    Write-Output '    curl.exe    VANG (Windows cu hon build 17063)'
  }

  $t = Get-Date
  $giayIwr = $null
  try {
    $r = Invoke-WebRequest -UseBasicParsing -UserAgent $UA -TimeoutSec $CHO_DO -Uri $goc
    $giayIwr = ((Get-Date) - $t).TotalSeconds
    Write-Output ('    IWR (.NET)  {0} sau {1:N2}s' -f $r.StatusCode, $giayIwr)
  } catch {
    $giayIwr = ((Get-Date) - $t).TotalSeconds
    Write-Output ('    IWR (.NET)  HONG sau {0:N2}s : {1}' -f $giayIwr, $_.Exception.GetType().Name)
  }

  # Ket luan phai noi ra ca CON SO va cai TRAN nó bị so với, khong thi nguoi doc phai tu tra.
  if ($null -ne $giayIwr) {
    if ($giayIwr -gt $TRAN_LAUNCHER) {
      Write-Output ('    ==> LAUNCHER KHONG HOI NOI FEED tren may nay: no di bang IWR voi tran {0}s, ma IWR can {1:N1}s.' -f $TRAN_LAUNCHER, $giayIwr)
      if ($hoDen -gt 0) {
        Write-Output ('        Nguyen nhan do duoc: {0} dia chi la HO DEN va DNS xep chung len truoc; .NET thu lan luot.' -f $hoDen)
      }
      Write-Output '        Nhanh catch cua launcher `exit 0` nen may nay im lang khong bao gio cap nhat.'
    } else {
      Write-Output ('    ==> IWR {0:N1}s < tran launcher {1}s: chang MANG khong phai cho truot.' -f $giayIwr, $TRAN_LAUNCHER)
    }
  }
}

# --- Feed noi gi ----------------------------------------------------------------------------
# Hoi bang giay to cua CHINH may nay, va khong in giay to ay ra. Muc dich: biet may NAY duoc
# phat goi nao, co bao nhieu byte, bam gi — de so voi tep do dang o tren.
Muc 'FEED NOI GI VOI MAY NAY'
$mongDoi = $null
foreach ($d in $coCai) {
  $tk = Join-Path $d 'token.txt'; $be = Join-Path $d 'backend.txt'
  if (-not (Test-Path $be)) { continue }
  $base = (Get-Content $be -Raw).Trim().TrimEnd('/')
  $pkg = Join-Path $d 'resources\app\package.json'
  $ver = ''
  if (Test-Path $pkg) { try { $ver = (Get-Content $pkg -Raw | ConvertFrom-Json).version } catch {} }
  $u = $base + '/updates/ban-moi?nen=windows&ver=' + [uri]::EscapeDataString($ver)
  if (Test-Path $tk) { $u += '&k=' + [uri]::EscapeDataString((Get-Content $tk -Raw).Trim()) }
  Write-Output ('  --- ' + (Che $d) + '  (khai ver=' + $ver + ')')
  $kq = Hoi $u
  if ($kq.loi) {
    # In ca LOAI ngoai le: "timed out" co the la TLS, proxy, hay mot duong ra chet — ba benh khac
    # han nhau, va mot cau chu chung cho ca ba la thu dan nguoi doc di sai duong. Muc DUONG RA MANG
    # o tren da tach chung ra; dong nay chi con la so ghi.
    Dong 'HOI FEED HONG' ($kq.loi + (' (qua ' + $kq.qua + ', {0:N1}s)' -f $kq.giay))
  } else {
    Dong 'HTTP' ('{0}  (qua {1}, {2:N2}s)' -f $kq.ma, $kq.qua, $kq.giay)
    if ($kq.ma -eq 200) {
      $b = $kq.than | ConvertFrom-Json
      $ten = if ($b.full -and $b.full.ten) { $b.full.ten } else { $b.ten }
      $sha = if ($b.full -and $b.full.sha256hash) { $b.full.sha256hash } else { $b.sha256hash }
      $url = if ($b.full -and $b.full.url) { $b.full.url } else { $b.url }
      Dong 'goi duoc phat' $ten
      Dong 'sha mong doi' $sha
      $kh = Hoi $url -ChiDau
      if ($kh.loi) {
        Dong 'co mong doi' ('HEAD hong: ' + $kh.loi)
      } else {
        # Hai ngan xep tra Content-Length o hai cho khac nhau: curl -I ghi CA KHOI dau muc ra
        # `output`, con IWR thi bo chung vao `.Headers`. Doc sai cho la "0 byte" — mot con so
        # nghe nhu mot du kien.
        $len = 0
        if ($kh.qua -eq 'curl') {
          $m = [regex]::Match(("" + $kh.than), '(?im)^content-length:\s*(\d+)')
          if ($m.Success) { $len = [int64]$m.Groups[1].Value }
        } elseif ($kh.hd) {
          $len = [int64]$kh.hd['Content-Length']
        }
        if ($len -gt 0) {
          Dong 'co mong doi' ('{0:N0} byte ({1:N1} MB)' -f $len, ($len / 1MB))
          $mongDoi = @{ ten = $ten; co = $len; sha = $sha; url = $url }
        } else {
          Dong 'co mong doi' ('HEAD {0} nhung khong doc duoc Content-Length' -f $kh.ma)
        }
      }
    }
  }
}

# So tep do dang voi co mong doi — day la cho tra loi "dut o dau".
if ($mongDoi -and $goi.Count -gt 0) {
  Muc 'TEP TRONG %TEMP% SO VOI CO MONG DOI'
  foreach ($f in $goi) {
    if ($f.Length -eq $mongDoi.co) {
      Dong $f.Name 'DU byte — tai xong, cho truot nam o buoc CAI'
    } else {
      Dong $f.Name ('{0:N0} / {1:N0} byte = {2:N1}% — TAI DO DANG, cho truot nam o buoc TAI' -f $f.Length, $mongDoi.co, (100 * $f.Length / $mongDoi.co))
    }
  }
}

# --- Su kien Windows ------------------------------------------------------------------------
Muc 'SU KIEN WINDOWS 7 NGAY QUA (loc theo ten goi / Defender)'
try {
  $tu = (Get-Date).AddDays(-7)
  $ev = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $tu } -MaxEvents 400 -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match 'Bot.?Noi.?Bo|Grok Bot|Inno Setup' }
  if ($ev) { $ev | Select-Object -First 12 | ForEach-Object { Write-Output ('  ' + (Gio $_.TimeCreated) + '  ' + $_.LevelDisplayName + '  ' + (Che ($_.Message -replace '\s+', ' ').Substring(0, [Math]::Min(180, $_.Message.Length)))) } }
  else { Write-Output '  khong co su kien nao nhac ten goi' }
} catch { Write-Output ('  doc Application log hong: ' + $_.Exception.Message) }

Muc 'DEFENDER DA CHAN GI (quet TRON log, khong chi 7 ngay)'
# Ba quyet dinh, ca ba tu so do 11/09 tren may dev:
#  (1) TRON log, khong 7 ngay — lan Defender CACH LY bo cai da phat hanh xay ra 03/09, tam ngay
#      truoc, nen mot cua so 7 ngay bo lo dung thu can tim.
#  (2) doc NAME/PATH/ACTION chu khong in 200 ky tu dau: cau tra loi nam o ba truong ay.
#  (3) GOM NHOM chu khong cat ngon — mot may vua bi chan mot lan se co hang chuc dong cua CUNG mot
#      chu ky trong mot phut, va chung day cai CU (cai dang can) ra khoi tam nhin.
# Hai loai chan KHAC HAN nhau nen phai tach: mot TEP bi cach ly = goi tai ve bien mat truoc khi pha
# 2 kip cai; mot DONG LENH bi giet = pha 1 khong chay mot dong nao. Truoc ban 11/09 ca hai deu cam.
try {
  $dh = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Windows Defender/Operational'; Id = 1006, 1007, 1008, 1116, 1117 } -MaxEvents 800 -ErrorAction Stop)
  $hang = @()
  foreach ($e in $dh) {
    $ten = ''; $duong = ''; $act = ''
    foreach ($l in ($e.Message -split "`r?`n")) {
      if ($ten -eq ''   -and $l -match '^\s*Name:\s*(.+)$')   { $ten   = $Matches[1].Trim() }
      if ($duong -eq '' -and $l -match '^\s*Path:\s*(.+)$')   { $duong = $Matches[1].Trim() }
      if ($act -eq ''   -and $l -match '^\s*Action:\s*(.+)$') { $act   = $Matches[1].Trim() }
    }
    $loai = 'TEP'
    if ($duong -match '^CmdLine:') { $loai = 'DONG LENH' }
    # "Cua ta" = ten goi, thu muc cai, vet banh mi, script pha 2, hoac dong lenh cua chinh pha 1.
    $cuaTa = ($duong -match 'Bot.?Noi.?Bo|grokbot2|cap-nhat-cuoi|bot-noi-bo-cap-nhat|updates/ban-moi')
    $hang += [pscustomobject]@{ Gio = $e.TimeCreated; Ten = $ten; Duong = $duong; Act = $act; Loai = $loai; CuaTa = $cuaTa }
  }
  $ta = @($hang | Where-Object { $_.CuaTa })
  Dong 'tong lan chan' $hang.Count
  Dong 'som nhat trong log' (Gio $hang[$hang.Count - 1].Gio)
  Dong 'dung vao goi CUA TA' $ta.Count
  if ($ta.Count -eq 0) { Write-Output '  khong lan nao dung vao goi hay launcher cua ta' }
  foreach ($g in @($ta | Group-Object { $_.Ten + '|' + $_.Loai } | Sort-Object { $_.Group[0].Gio })) {
    $n = @($g.Group)
    $acts = @($n | ForEach-Object { $_.Act } | Where-Object { $_ } | Sort-Object -Unique) -join ','
    if (-not $acts) { $acts = '(chi phat hien)' }
    Write-Output ('  >> ' + $n[0].Ten + '  [' + $n[0].Loai + ']  x' + $n.Count)
    Write-Output ('       tu ' + (Gio $n[$n.Count - 1].Gio) + ' den ' + (Gio $n[0].Gio) + '   action: ' + $acts)
    $d = Che $n[$n.Count - 1].Duong
    Write-Output ('       ' + $d.Substring(0, [Math]::Min(140, $d.Length)))
  }
  if ($ta.Count -gt 0) {
    Write-Output ''
    Write-Output '  ==> DEFENDER DA CHAN GOI HAY LAUNCHER CUA TA TREN MAY NAY. Doc dong [TEP] va'
    Write-Output '      [DONG LENH] o tren: TEP bi cach ly thi pha 2 khong con file de cai; DONG'
    Write-Output '      LENH bi giet thi pha 1 khong chay mot dong nao. Truoc ban 11/09 ca hai ca'
    Write-Output '      deu KHONG de lai dau vet nao tren may.'
  }
} catch {
  if ($_.Exception.Message -match 'No events were found') { Write-Output '  khong co lan chan nao trong log' }
  else { Write-Output ('  Defender: khong doc duoc log (' + $_.Exception.Message + ')') }
}

# --- Dung lai luot tai (tuy chon) -----------------------------------------------------------
if ($ThuTai -and $mongDoi) {
  Muc 'DUNG LAI LUOT TAI (-ThuTai)'
  $ra = Join-Path $env:TEMP ('thu-tai-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.bin')
  $t0 = Get-Date
  try {
    # Di bang curl neu co: tren mot may mang IPv6 ho den thi IWR khong bao gio tai duoc, va luc ay
    # "-ThuTai DUT o 0 byte" la ket qua cua ngan xep, khong phai cua duong tai.
    if ($COCURL) {
      $muc = New-Object 'System.Collections.Generic.List[object]'
      $muc.Add('silent'); $muc.Add('show-error')
      $muc.Add(@('user-agent', $UA))
      $muc.Add(@('max-time', 900))
      $muc.Add(@('output', $ra))
      $muc.Add(@('url', $mongDoi.url))
      $f = CurlCfg $muc
      try { & $CURL -K $f; $maThoat = $LASTEXITCODE } finally { Remove-Item $f -Force -ErrorAction SilentlyContinue }
      if ($maThoat -ne 0) { throw ('curl thoat ' + $maThoat) }
    } else {
      Invoke-WebRequest -UseBasicParsing -UserAgent $UA -TimeoutSec 900 -Uri $mongDoi.url -OutFile $ra
    }
    $n = (Get-Item $ra).Length
    Dong 'ket qua' ('XONG · {0:N0} byte · {1:N0} s' -f $n, ((Get-Date) - $t0).TotalSeconds)
    Dong 'sha' (Get-FileHash $ra -Algorithm SHA256).Hash.ToLower()
    Dong 'khop manifest' $(if ((Get-FileHash $ra -Algorithm SHA256).Hash.ToLower() -eq $mongDoi.sha.ToLower()) { 'CO' } else { 'KHONG — bam lech' })
  } catch {
    $n = if (Test-Path $ra) { (Get-Item $ra).Length } else { 0 }
    Dong 'ket qua' ('DUT · {0:N0} / {1:N0} byte ({2:N1}%) sau {3:N0} s' -f $n, $mongDoi.co, (100 * $n / $mongDoi.co), ((Get-Date) - $t0).TotalSeconds)
    Dong 'loi' $_.Exception.Message
  } finally {
    Remove-Item $ra -Force -ErrorAction SilentlyContinue
  }
}

Write-Output ''
Write-Output '########## HET — chep nguyen khoi tren gui ve ##########'
